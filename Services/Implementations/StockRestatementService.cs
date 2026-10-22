using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>A restatement the books refuse; <see cref="Status"/> is the HTTP code a screen answers with.</summary>
    public sealed class StockRestatementRefusedException(int status, string message) : Exception(message)
    {
        public int Status { get; } = status;
    }

    /// <summary>The late-GD plan: the items it lists, the restatements that fix them, and each item's preview.</summary>
    public sealed record LateGdPlan(
        List<BackdatedGdRestatement.Affected> Affected,
        List<FifoRestatementRequestDto> Requests,
        List<FifoRestatementItemDto> Items);

    /// <summary>
    /// FIFO restatement to GD lines, and the late-GD fix built on it. One implementation for the
    /// Stock screen (StockController), the MCP tools and the GD save, which re-matches its own
    /// items as soon as a back-dated GD is committed.
    /// </summary>
    public sealed class StockRestatementService(
        AppDbContext context, IDivisionAccessGuard divisionAccess, IPostingService posting, IAuditLogService audit)
    {
        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

        private static StockRestatementRefusedException Refused(string message) => new(400, message);

        /// <summary>
        /// Restate items to a stock sheet's GD lines under FIFO by GD (CLAUDE.md
        /// 5b-17): from today each listed item holds exactly those lines, so its
        /// value and every GD's balance equal the sheet. Quantity never moves --
        /// an item whose sheet quantity is not its on-hand is refused. Preview
        /// unless <c>Commit</c>; a commit writes one value-only movement per item
        /// (which also lands the weighted average on the sheet's value), its
        /// lines, re-posts the month's COGS relief, and is audited.
        /// </summary>
        public async Task<FifoRestatementResultDto> RestateAsync(
            int companyId, int userId, string? userName, FifoRestatementRequestDto req)
        {
            if (req?.Lines == null || req.Lines.Count == 0)
                throw Refused("Send the sheet's lines.");
            if (!await StockCostingMethod.IsGdFifoAsync(context, companyId))
                throw Refused("Restating to GD lines needs the company on FIFO by GD.");
            // A division-restricted caller sees part of the movements; a
            // restatement must be measured against the whole company's stock.
            if (await divisionAccess.GetAccessibleDivisionIdsAsync(userId, companyId) != null)
                throw new StockRestatementRefusedException(403, "Restating stock needs access to every division.");
            foreach (var l in req.Lines)
            {
                if (string.IsNullOrWhiteSpace(l.GdNumber) || l.GdNumber.Trim().Length > 100)
                    throw Refused($"Row {l.SourceRow}: a GD number is required.");
                if (l.Quantity <= 0m || l.ValueExcludingTax < 0m || l.SalesTaxRate < 0m || l.SalesTaxRate >= 100m)
                    throw Refused($"Row {l.SourceRow}: quantity must be above zero, value not negative, rate 0 to under 100.");
                if (l.ClaimMonth is { } cm && (cm.Day != 1 || cm.TimeOfDay != TimeSpan.Zero))
                    throw Refused($"Row {l.SourceRow}: claim month must be the first day of the month.");
            }

            var openings = await context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity), Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax), Rate = g.Max(o => o.SalesTaxRate),
                }).ToDictionaryAsync(x => x.ItemTypeId);
            // A restatement is dated on the day its sheet describes (2026-10-05).
            // Dated "today" it sat after the month it restated, so the month's
            // own sheet, Annex-H1 and tie-out never saw it (Alpha, Sep 2026).
            // Quantities are checked as they stood on that day, so a sale made
            // since does not refuse a sheet that was right when it was taken.
            var restateOn = (req.AsOf ?? PakistanClock.Today).Date;
            if (restateOn > PakistanClock.Today)
                throw Refused("The sheet's date is in the future.");
            var cutoff = restateOn.AddDays(1);
            var allMoves = await context.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId).ToListAsync();
            var moves = allMoves.Where(m => m.MovementDate < cutoff)
                .GroupBy(m => m.ItemTypeId).ToDictionary(g => g.Key, g => g.ToList());
            var held = openings.Keys.Union(allMoves.Select(m => m.ItemTypeId)).Distinct().ToList();
            var names = await context.ItemTypes.AsNoTracking().Where(i => held.Contains(i.Id))
                .Select(i => new { i.Id, i.Name, i.HSCode }).ToDictionaryAsync(i => i.Id);
            var costing = await StockCosting.LoadAsync(context, companyId, held);

            var result = new FifoRestatementResultDto();
            var plans = new List<(FifoRestatementItemDto Item, List<FifoRestatementLineDto> Lines, decimal WaValue)>();
            foreach (var g in req.Lines.GroupBy(l => l.ItemTypeId))
            {
                var id = g.Key;
                var item = new FifoRestatementItemDto
                {
                    ItemTypeId = id, LineCount = g.Count(),
                    SheetQuantity = g.Sum(l => l.Quantity),
                    SheetValue = Money(g.Sum(l => l.ValueExcludingTax)),
                };
                if (!names.TryGetValue(id, out var n))
                {
                    item.Error = "This company holds no stock record for that item.";
                    result.Items.Add(item);
                    continue;
                }
                item.ItemTypeName = n.Name; item.HsCode = n.HSCode;
                var o = openings.GetValueOrDefault(id);
                var ms = moves.GetValueOrDefault(id) ?? new List<StockMovement>();
                var wa = StockValuation.Compute(o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                var fifo = costing.Compute(id, o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                item.OnHand = fifo.Quantity;
                item.FifoValue = fifo.ValueExcludingTax;
                item.WeightedAverageValue = wa.ValueExcludingTax;
                item.LandedValue = wa.ActualValueExcludingTax;
                if (Math.Abs(item.SheetQuantity - item.OnHand) > 0.0001m)
                    item.Error = $"The sheet has {item.SheetQuantity:0.####} but {item.OnHand:0.####} is on hand. " +
                                 "Correct the quantity first (a stock adjustment); a restatement never moves quantity.";
                result.Items.Add(item);
                plans.Add((item, g.OrderBy(l => l.SourceRow).ToList(), wa.ValueExcludingTax));
            }
            var listed = req.Lines.Select(l => l.ItemTypeId).ToHashSet();
            foreach (var id in held.Where(i => !listed.Contains(i)))
            {
                var o = openings.GetValueOrDefault(id);
                var ms = moves.GetValueOrDefault(id) ?? new List<StockMovement>();
                var p = costing.Compute(id, o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                if (Math.Abs(p.Quantity) <= 0.0001m && Math.Abs(p.ValueExcludingTax) <= 0.005m) continue;
                result.NotInSheet.Add(new FifoRestatementItemDto
                {
                    ItemTypeId = id, ItemTypeName = names.GetValueOrDefault(id)?.Name ?? "",
                    HsCode = names.GetValueOrDefault(id)?.HSCode, OnHand = p.Quantity, FifoValue = p.ValueExcludingTax,
                });
            }
            result.FifoValueBefore = Money(result.Items.Sum(i => i.FifoValue) + result.NotInSheet.Sum(i => i.FifoValue));
            result.SheetValue = Money(result.Items.Sum(i => i.SheetValue));
            result.CanCommit = result.Items.Count > 0 && result.Items.All(i => i.Error == null);
            if (!req.Commit || !result.CanCommit) return result;

            var file = string.IsNullOrWhiteSpace(req.SourceFile) ? null
                : Path.GetFileName(req.SourceFile.Trim()) is var f && f.Length > 260 ? f[..260] : Path.GetFileName(req.SourceFile.Trim());
            // Joins a caller's transaction when there is one (Reconcile to sheet).
            await using (var tx = context.Database.CurrentTransaction == null
                             ? await context.Database.BeginTransactionAsync() : null)
            {
                foreach (var (item, lines, waValue) in plans)
                {
                    // The same movement lands the weighted average on the sheet's
                    // total, so switching method back keeps the sheet's figure.
                    var movement = new StockMovement
                    {
                        CompanyId = companyId, ItemTypeId = item.ItemTypeId,
                        Direction = StockMovementDirection.In, Quantity = 0m,
                        SourceType = StockMovementSourceType.Revaluation, MovementDate = restateOn,
                        ValueAdjustmentExcludingTax = Money(item.SheetValue - waValue) is var d && d != 0m ? d : null,
                        Notes = $"FIFO restatement to stock sheet{(file != null ? $" {file}" : "")}: {lines.Count} GD lines",
                    };
                    context.StockMovements.Add(movement);
                    await context.SaveChangesAsync();

                    // The item's landed value at the restatement, spread over its
                    // lines by value -- the sheet's own cost columns are formulas.
                    var basis = lines.Sum(l => l.ValueExcludingTax);
                    decimal given = 0m;
                    for (var i = 0; i < lines.Count; i++)
                    {
                        var l = lines[i];
                        var actual = i == lines.Count - 1 ? Money(item.LandedValue) - given
                            : basis > 0m ? Money(item.LandedValue * l.ValueExcludingTax / basis) : 0m;
                        given += actual;
                        context.StockRestatementLines.Add(new StockRestatementLine
                        {
                            CompanyId = companyId, ItemTypeId = item.ItemTypeId, StockMovementId = movement.Id,
                            GdNumber = l.GdNumber.Trim(), GdDate = l.GdDate?.Date, ClaimMonth = l.ClaimMonth,
                            SourceRow = l.SourceRow, Description = l.Description?.Trim() is { Length: > 300 } s ? s[..300] : l.Description?.Trim(),
                            Quantity = l.Quantity, ValueExcludingTax = Money(l.ValueExcludingTax),
                            ActualValueExcludingTax = actual, SalesTaxRate = l.SalesTaxRate, SourceFile = file,
                        });
                    }
                    await context.SaveChangesAsync();
                }
                if (tx != null) await tx.CommitAsync();
            }

            // The value change is an adjustment in the relief of the sheet's month.
            await posting.PostInventoryPeriodsAsync(companyId, restateOn);
            await audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = userName,
                HttpMethod = "POST",
                RequestPath = $"/api/stock/company/{companyId}/fifo-restatement",
                StatusCode = 200,
                ExceptionType = "STOCK_FIFO_RESTATEMENT",
                // Each is its own action: never folded into an earlier row by
                // the 24h dedup (built for error floods).
                Fingerprint = Guid.NewGuid().ToString("N"),
                Message = $"FIFO restatement for company {companyId}: {plans.Count} items, {req.Lines.Count} GD lines, " +
                          $"value {result.FifoValueBefore:0.00} -> sheet {result.SheetValue:0.00}{(file != null ? $" from {file}" : "")}",
                CompanyId = companyId,
            });
            result.Committed = true;
            return result;
        }

        /// <summary>
        /// The restatements that would put every late-GD item right, kept to
        /// the items whose value they would actually change (or that cannot be
        /// restated -- those carry the error). Writes nothing: every call to
        /// RestateFifo here is a preview. One request per match date. Pass 1
        /// learns each item's on-hand on that date; pass 2 trims the sheet
        /// lines to it (BackdatedGdRestatement.BuildLines).
        /// </summary>
        public async Task<LateGdPlan> PlanLateGdsAsync(int companyId, int userId, ICollection<int>? onlyItemTypeIds = null)
        {
            var affected = await BackdatedGdRestatement.FindAsync(context, companyId);
            if (onlyItemTypeIds != null) affected = affected.Where(a => onlyItemTypeIds.Contains(a.ItemTypeId)).ToList();
            if (affected.Count == 0) return new LateGdPlan(new(), new(), new());

            var matchIds = affected.Select(a => a.Restatement.MovementId).ToList();
            var sheet = (await context.StockRestatementLines.AsNoTracking()
                    .Where(r => r.CompanyId == companyId && matchIds.Contains(r.StockMovementId))
                    .ToListAsync())
                .GroupBy(r => r.StockMovementId)
                .ToDictionary(g => g.Key, g => (IReadOnlyList<FifoRestatementLineDto>)g
                    .OrderBy(r => r.SourceRow).ThenBy(r => r.Id)
                    .Select(r => new FifoRestatementLineDto
                    {
                        ItemTypeId = r.ItemTypeId, GdNumber = r.GdNumber, GdDate = r.GdDate, ClaimMonth = r.ClaimMonth,
                        SourceRow = r.SourceRow, Description = r.Description, Quantity = r.Quantity,
                        ValueExcludingTax = r.ValueExcludingTax, SalesTaxRate = r.SalesTaxRate,
                    }).ToList());
            // A value correction has no sheet: what it left the item holding is the
            // walk's pools on its date without the late GDs. An item holding stock
            // not traced to a GD cannot be restated that way and is listed with
            // the reason instead.
            var held = new Dictionary<int, IReadOnlyList<FifoRestatementLineDto>>();
            var untraced = new List<(BackdatedGdRestatement.Affected A, FifoRestatementItemDto Item)>();
            foreach (var a in affected.Where(a => !a.Restatement.IsSheetMatch).ToList())
            {
                var lines = await BackdatedGdRestatement.HeldLinesAsync(context, companyId, a);
                if (lines != null) { held[a.Restatement.MovementId] = lines; continue; }
                affected.Remove(a);
                untraced.Add((a, new FifoRestatementItemDto
                {
                    ItemTypeId = a.ItemTypeId,
                    ItemTypeName = await context.ItemTypes.AsNoTracking().Where(i => i.Id == a.ItemTypeId).Select(i => i.Name).FirstOrDefaultAsync() ?? "",
                    Error = "Holds stock not traced to a GD, so the late GD cannot be added automatically. Restate it from your stock sheet.",
                }));
            }
            IReadOnlyList<FifoRestatementLineDto> SheetOf(BackdatedGdRestatement.Affected a) =>
                (a.Restatement.IsSheetMatch ? sheet.GetValueOrDefault(a.Restatement.MovementId) : held.GetValueOrDefault(a.Restatement.MovementId))
                ?? new List<FifoRestatementLineDto>();

            Task<FifoRestatementResultDto> PreviewAsync(FifoRestatementRequestDto r)
            {
                r.Commit = false;
                return RestateAsync(companyId, userId, null, r);
            }

            var keep = new List<BackdatedGdRestatement.Affected>();
            var requests = new List<FifoRestatementRequestDto>();
            var items = new List<FifoRestatementItemDto>();
            foreach (var g in affected.GroupBy(a => a.Restatement.Date).OrderBy(g => g.Key))
            {
                var probe = await PreviewAsync(new FifoRestatementRequestDto
                {
                    AsOf = g.Key,
                    Lines = g.SelectMany(a => BackdatedGdRestatement.BuildLines(
                        a.ItemTypeId, g.Key, SheetOf(a), a.Lines, decimal.MaxValue)).ToList(),
                });
                var onHand = probe.Items.ToDictionary(i => i.ItemTypeId, i => i.OnHand);
                var lines = g.ToDictionary(a => a.ItemTypeId, a => BackdatedGdRestatement.BuildLines(
                    a.ItemTypeId, g.Key, SheetOf(a), a.Lines, onHand.GetValueOrDefault(a.ItemTypeId)));
                var full = await PreviewAsync(new FifoRestatementRequestDto
                {
                    AsOf = g.Key, Lines = lines.Values.SelectMany(l => l).ToList(),
                });

                // Only what the update would change (or cannot do) is offered. A
                // GD arrival's movement holds its unit cost at 4dp, so its value can
                // sit qty x 0.00005 off the sheet's (CLAUDE.md 5b-15): paisa that are
                // not a wrong value. Pak Trade's 8 untouched items differed by
                // 0.01-0.04 and were listed as needing a fix until this tolerance.
                var changed = full.Items
                    .Where(i => i.Error != null
                                || Math.Abs(i.FifoValue - i.SheetValue) >= 1m + Math.Abs(i.SheetQuantity) * 0.0001m)
                    .ToList();
                if (changed.Count == 0) continue;
                var ids = changed.Select(i => i.ItemTypeId).ToHashSet();
                keep.AddRange(g.Where(a => ids.Contains(a.ItemTypeId)));
                items.AddRange(changed);
                requests.Add(new FifoRestatementRequestDto
                {
                    SourceFile = $"{(g.All(a => a.Restatement.IsSheetMatch) ? "Stock-sheet match" : "Stock value correction")} of {g.Key:dd MMM yyyy} with late GD " +
                                 string.Join(", ", g.Where(a => ids.Contains(a.ItemTypeId))
                                     .SelectMany(a => a.Lines.Select(l => l.GdNumber)).Distinct().OrderBy(x => x)),
                    AsOf = g.Key,
                    Lines = lines.Where(kv => ids.Contains(kv.Key)).SelectMany(kv => kv.Value).ToList(),
                });
            }
            keep.AddRange(untraced.Select(u => u.A));
            items.AddRange(untraced.Select(u => u.Item));
            return new LateGdPlan(keep, requests, items);
        }

        /// <summary>
        /// "Add these GDs to the last stock-sheet match": restates every listed
        /// item again ON THE MATCH DATE with that match's lines plus the late GD
        /// lines, through the ordinary restatement (same checks, same audit).
        /// Preview unless Commit; all items in one transaction. Quantity never
        /// moves.
        /// </summary>
        public async Task<BackdatedGdRestateResultDto> RestateLateGdsAsync(
            int companyId, int userId, string? userName, bool commit,
            ICollection<int>? onlyItemTypeIds = null, string? requestPath = null)
        {
            var plan = await PlanLateGdsAsync(companyId, userId, onlyItemTypeIds);
            var result = new BackdatedGdRestateResultDto
            {
                Items = plan.Items,
                CanCommit = plan.Items.Count > 0 && plan.Items.All(i => i.Error == null),
                ValueBefore = plan.Items.Sum(i => i.FifoValue),
                ValueAfter = plan.Items.Sum(i => i.SheetValue),
            };
            if (plan.Items.Count == 0)
            {
                result.Messages.Add("Nothing to update: every item is already valued with its late GDs.");
                return result;
            }
            if (!commit || !result.CanCommit) return result;

            await using var tx = await context.Database.BeginTransactionAsync();
            try
            {
                foreach (var r in plan.Requests)
                {
                    r.Commit = true;
                    var res = await RestateAsync(companyId, userId, userName, r);
                    if (!res.Committed)
                        throw Refused("The stock-sheet match could not be updated: "
                            + string.Join("; ", res.Items.Where(i => i.Error != null).Select(i => $"{i.ItemTypeName}: {i.Error}")) + ".");
                }
                await tx.CommitAsync();
            }
            catch (StockRestatementRefusedException ex)
            {
                await tx.RollbackAsync();
                throw new StockRestatementRefusedException(ex.Status, ex.Message + " Nothing was changed.");
            }
            result.Committed = true;
            var gds = string.Join(", ", plan.Affected.SelectMany(a => a.Lines.Select(l => l.GdNumber)).Distinct().OrderBy(g => g));
            result.Messages.Add($"{plan.Items.Count} item(s) brought back in line with the stock sheet, now including GD {gds}. Quantities did not change.");
            await audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = userName,
                HttpMethod = "POST",
                RequestPath = requestPath ?? $"/api/stock/company/{companyId}/backdated-gds/restate",
                StatusCode = 200,
                ExceptionType = "STOCK_LATE_GD_RESTATE",
                // Each is its own action: never folded into an earlier row by
                // the 24h dedup (built for error floods).
                Fingerprint = Guid.NewGuid().ToString("N"),
                Message = $"Late GD {gds} added to the stock-sheet match for {plan.Items.Count} item(s) of company {companyId}: " +
                          $"value {result.ValueBefore:0.00} -> {result.ValueAfter:0.00}",
                CompanyId = companyId,
            });
            return result;
        }
    }
}
