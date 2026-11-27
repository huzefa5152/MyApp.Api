using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IGdRevisionService"/>
    public class GdRevisionService : IGdRevisionService
    {
        private const decimal Epsilon = 0.0001m;
        private const decimal SettledEpsilon = 0.005m;
        private const string OversoldRow = "More of this item has already been sold than the revised GD brings.";

        private readonly AppDbContext _db;
        private readonly IGdCostingImportService _gdImport;
        private readonly IImportConsignmentService _consignments;
        private readonly IPostingService _posting;
        private readonly StockRestatementService _restatements;
        private readonly ILogger<GdRevisionService> _logger;

        public GdRevisionService(
            AppDbContext db,
            IGdCostingImportService gdImport,
            IImportConsignmentService consignments,
            IPostingService posting,
            StockRestatementService restatements,
            ILogger<GdRevisionService> logger)
        {
            _db = db;
            _gdImport = gdImport;
            _consignments = consignments;
            _posting = posting;
            _restatements = restatements;
            _logger = logger;
        }

        // -- The GD as a sheet -------------------------------------------------

        public async Task<(byte[] Bytes, string FileName, int CompanyId)?> ExportAsync(int consignmentId)
        {
            var consignment = await _db.ImportConsignments.AsNoTracking()
                .Include(c => c.Lines)
                .FirstOrDefaultAsync(c => c.Id == consignmentId);
            if (consignment == null) return null;

            // Column positions are GdCostingLayout's: the file reads back with the
            // built-in layout, and the round trip changes nothing.
            using var wb = new XLWorkbook();
            var ws = wb.AddWorksheet("GD");
            var heads = new (int Col, string Text)[]
            {
                (1, "GD Number"), (2, "GD Date"), (3, "Description"), (4, "Qty"), (5, "Unit"), (6, "HS Code"),
                (7, "Assessed Value"), (8, "C.Duty"), (9, "ACD"), (10, "RD"), (12, "ST Rate"), (14, "AST Rate"),
                (16, "Others"), (19, "I.tax Rate"), (22, "Add On Profit if Need"), (23, "Selling Value"),
            };
            foreach (var (col, text) in heads) ws.Cell(1, col).Value = text;
            ws.Row(1).Style.Font.Bold = true;
            ws.Cell(2, 1).Value = "Edit the rows below, add or delete rows, then upload this file with Revise from sheet. Keep the GD number.";
            ws.Cell(2, 1).Style.Font.Italic = true;

            var row = 3;
            foreach (var l in consignment.Lines.OrderBy(l => l.SourceRow).ThenBy(l => l.Id))
            {
                ws.Cell(row, 1).Value = consignment.GdNumber;
                ws.Cell(row, 2).Value = consignment.GdDate.ToString("dd-MM-yyyy");
                ws.Cell(row, 3).Value = l.DescriptionOnSheet ?? "";
                ws.Cell(row, 4).Value = l.Quantity;
                ws.Cell(row, 5).Value = l.Unit ?? "";
                ws.Cell(row, 6).Value = l.HsCode ?? "";
                ws.Cell(row, 7).Value = l.AssessedValue;
                ws.Cell(row, 8).Value = l.CustomsDuty;
                ws.Cell(row, 9).Value = l.Acd;
                ws.Cell(row, 10).Value = l.RegulatoryDuty;
                ws.Cell(row, 12).Value = l.SalesTaxRate;
                ws.Cell(row, 14).Value = l.AstRate;
                ws.Cell(row, 16).Value = l.Others;
                ws.Cell(row, 19).Value = l.IncomeTaxRate;
                ws.Cell(row, 22).Value = l.AddOnProfit;
                // Stated only when it was typed over the costing: a selling value
                // the costing gives is left blank, so it follows an edited row.
                var worked = ImportCostingCalculator.Compute(new ImportCostingCalculator.ImportCostingInput(
                    l.AssessedValue, l.CustomsDuty, l.Acd, l.RegulatoryDuty, l.Others,
                    l.SalesTaxRate, l.AstRate, l.IncomeTaxRate, l.AddOnProfit)).SellingValue;
                if (Math.Abs(Money(worked) - l.SellingValueExcludingTax) > 0.01m)
                    ws.Cell(row, 23).Value = l.SellingValueExcludingTax;
                row++;
            }
            ws.Column(1).Width = 18; ws.Column(2).Width = 12; ws.Column(3).Width = 42; ws.Column(6).Width = 12;
            foreach (var col in new[] { 7, 8, 9, 10, 16, 22, 23 }) ws.Column(col).Width = 15;

            using var ms = new MemoryStream();
            wb.SaveAs(ms);
            var safe = new string(consignment.GdNumber.Select(c => char.IsLetterOrDigit(c) || c == '-' ? c : '_').ToArray());
            return (ms.ToArray(), $"GD-{safe}.xlsx", consignment.CompanyId);
        }

        // -- Preview -----------------------------------------------------------

        public async Task<GdRevisionPreviewDto> PreviewAsync(
            int consignmentId, byte[] bytes, string extension, string fileName, string fileSha256,
            string mappingJson, int? profileId, int? profileVersion)
        {
            var consignment = await _db.ImportConsignments.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == consignmentId)
                ?? throw new InvalidOperationException("That consignment no longer exists.");
            var sheet = await _gdImport.PreviewAsync(
                bytes, extension, fileName, fileSha256, mappingJson, consignment.CompanyId,
                profileId, profileVersion, GdCostingImportModeNames.NewArrivals, revisingGd: consignment.GdNumber);
            return await PreviewLinesAsync(consignmentId, sheet);
        }

        public async Task<GdRevisionPreviewDto> PreviewLinesAsync(int consignmentId, GdCostingPreviewDto sheet)
        {
            var consignment = await _db.ImportConsignments.AsNoTracking()
                .Include(c => c.Lines)
                .FirstOrDefaultAsync(c => c.Id == consignmentId)
                ?? throw new InvalidOperationException("That consignment no longer exists.");
            return (await BuildPlanAsync(consignment, sheet)).Preview;
        }

        private sealed record Plan(
            GdRevisionPreviewDto Preview,
            List<(ImportConsignmentLine Old, GdCostingLineDto New)> Changed,
            List<GdCostingLineDto> Added,
            List<ImportConsignmentLine> Removed);

        private static string Norm(string? s) => (s ?? "").Trim().ToUpperInvariant();

        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

        /// <summary>The selling value a sheet line lands with: stated on the sheet, else worked out.</summary>
        private static decimal Selling(GdCostingLineDto l) => Money(l.SheetSellingValue ?? l.SellingValue);

        private static bool Differs(ImportConsignmentLine o, GdCostingLineDto n) =>
            Math.Abs(o.Quantity - n.Quantity) > Epsilon
            || Money(o.AssessedValue) != Money(n.AssessedValue)
            || Money(o.CustomsDuty) != Money(n.CustomsDuty)
            || Money(o.Acd) != Money(n.Acd)
            || Money(o.RegulatoryDuty) != Money(n.RegulatoryDuty)
            || Money(o.Others) != Money(n.Others)
            || o.SalesTaxRate != n.SalesTaxRate
            || o.AstRate != n.AstRate
            || o.IncomeTaxRate != n.IncomeTaxRate
            || Money(o.AddOnProfit) != Money(n.AddOnProfit)
            || Math.Abs(o.SellingValueExcludingTax - Selling(n)) > 0.01m
            || Norm(o.DescriptionOnSheet) != Norm(n.Description);

        private async Task<Plan> BuildPlanAsync(ImportConsignment consignment, GdCostingPreviewDto sheet)
        {
            var preview = new GdRevisionPreviewDto
            {
                ConsignmentId = consignment.Id,
                GdNumber = consignment.GdNumber,
                Sheet = sheet,
            };
            var changed = new List<(ImportConsignmentLine, GdCostingLineDto)>();
            var added = new List<GdCostingLineDto>();
            var removed = new List<ImportConsignmentLine>();
            Plan Done() => new(preview, changed, added, removed);

            preview.BlockingErrors.AddRange(sheet.BlockingErrors);
            preview.Warnings.AddRange(sheet.Warnings);

            if (GdCostingImportModeNames.Normalize(consignment.Mode) != GdCostingImportModeNames.NewArrivals)
            {
                preview.BlockingErrors.Add(
                    $"GD {consignment.GdNumber} priced stock that was already on the books (Backfill). Correct its lines one at a time; a sheet revision is for a GD whose goods arrived.");
                return Done();
            }
            if (await _db.ImportConsignmentCharges.AnyAsync(c => c.ImportConsignmentId == consignment.Id))
            {
                preview.BlockingErrors.Add(
                    $"GD {consignment.GdNumber} has charges spread over its lines. Remove the charges, revise the GD, then add them again.");
                return Done();
            }

            var gd = Norm(consignment.GdNumber);
            var others = sheet.Lines.Where(l => Norm(l.GdNumber) != gd).Select(l => l.GdNumber.Trim())
                .Where(g => g.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (others.Count > 0)
                preview.Warnings.Add(
                    $"Rows for GD {string.Join(", ", others)} were ignored: this revises GD {consignment.GdNumber} only.");
            var revised = sheet.Lines.Where(l => Norm(l.GdNumber) == gd && !l.LeaveOut).OrderBy(l => l.SourceRow).ToList();
            if (revised.Count == 0)
            {
                preview.BlockingErrors.Add($"The sheet has no rows for GD {consignment.GdNumber}.");
                return Done();
            }

            // Pair each sheet row with the recorded line it revises: the same
            // description under the same HS code first, then the same item.
            var free = consignment.Lines.OrderBy(l => l.SourceRow).ThenBy(l => l.Id).ToList();
            var pairs = new Dictionary<GdCostingLineDto, ImportConsignmentLine>();
            foreach (var n in revised)
            {
                var hit = free.FirstOrDefault(o =>
                    GdCostingMapping.CleanHsCode(o.HsCode) == GdCostingMapping.CleanHsCode(n.HsCode)
                    && Norm(o.DescriptionOnSheet) == Norm(n.Description));
                if (hit == null) continue;
                pairs[n] = hit;
                free.Remove(hit);
            }
            foreach (var n in revised.Where(n => !pairs.ContainsKey(n) && n.ItemTypeId.HasValue))
            {
                var hit = free.FirstOrDefault(o => o.ItemTypeId == n.ItemTypeId);
                if (hit == null) continue;
                pairs[n] = hit;
                free.Remove(hit);
            }

            var itemIds = consignment.Lines.Where(l => l.ItemTypeId.HasValue).Select(l => l.ItemTypeId!.Value)
                .Concat(revised.Where(l => l.ItemTypeId.HasValue).Select(l => l.ItemTypeId!.Value)).Distinct().ToList();
            var itemNames = await _db.ItemTypes.AsNoTracking().Where(i => itemIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, i => i.Name);
            string? Item(int? id) => id.HasValue && itemNames.TryGetValue(id.Value, out var name) ? name : null;

            foreach (var n in revised)
            {
                pairs.TryGetValue(n, out var o);
                var row = new GdRevisionRowDto
                {
                    SheetRow = n.SourceRow,
                    LineId = o?.Id,
                    HsCode = n.HsCode,
                    Description = n.Description,
                    Unit = n.Unit,
                    ItemTypeName = Item(o?.ItemTypeId ?? n.ItemTypeId) ?? n.ItemTypeName ?? n.NewItemName,
                    OldQuantity = o?.Quantity,
                    NewQuantity = n.Quantity,
                    OldCost = o?.CostExcludingTax,
                    NewCost = Money(n.Cost),
                    OldSellingValue = o?.SellingValueExcludingTax,
                    NewSellingValue = Selling(n),
                };
                if (o == null)
                {
                    row.Action = GdRevisionActions.New;
                    if (n.Disposition == GdCostingDispositionNames.Ambiguous)
                        row.Problems.Add("Several items share this HS code. Name the row as the item is named on your books.");
                    else if (n.Disposition != GdCostingDispositionNames.CostOnly
                             && n.Disposition != GdCostingDispositionNames.StockPosted)
                        row.Problems.Add("This row cannot be brought into stock as it stands.");
                    added.Add(n);
                }
                else if (Differs(o, n))
                {
                    row.Action = GdRevisionActions.Changed;
                    if (o.StockMovementId == null && o.Disposition != GdCostingDisposition.Skipped
                        && o.Disposition != GdCostingDisposition.Ambiguous)
                        row.Problems.Add("This line was recorded before arrivals were kept as their own stock entries. Correct it on its own.");
                    changed.Add((o, n));
                }
                if (row.Action != GdRevisionActions.Unchanged)
                    row.Problems.AddRange(n.Problems.Select(p => p.Message));
                preview.Rows.Add(row);
            }
            foreach (var o in free)
            {
                removed.Add(o);
                preview.Rows.Add(new GdRevisionRowDto
                {
                    Action = GdRevisionActions.Removed,
                    LineId = o.Id,
                    HsCode = o.HsCode,
                    Description = o.DescriptionOnSheet,
                    Unit = o.Unit,
                    ItemTypeName = Item(o.ItemTypeId),
                    OldQuantity = o.Quantity,
                    OldCost = o.CostExcludingTax,
                    OldSellingValue = o.SellingValueExcludingTax,
                });
            }

            // Nothing may end up holding less than nothing: what the revised GD
            // brings of an item, against what has already left.
            var held = await HeldAsync(consignment.CompanyId, itemIds);
            foreach (var itemId in itemIds)
            {
                var before = consignment.Lines.Where(l => l.ItemTypeId == itemId && l.StockMovementId != null).Sum(l => l.Quantity);
                var after = revised.Sum(n =>
                    (pairs.TryGetValue(n, out var o) ? o.StockMovementId != null && o.ItemTypeId == itemId : n.ItemTypeId == itemId)
                        ? n.Quantity : 0m);
                var holding = held.GetValueOrDefault(itemId);
                if (holding + after - before >= -Epsilon) continue;
                var message =
                    $"\"{Item(itemId)}\": this GD brought in {before:0.####} and the revised sheet brings {after:0.####}, "
                    + $"but only {holding:0.####} is still held. {before - after - holding:0.####} of it has already been sold or moved, "
                    + "so the revised quantity cannot be less than what left.";
                preview.BlockingErrors.Add(message);
                foreach (var row in preview.Rows.Where(r => r.Action != GdRevisionActions.Unchanged
                             && r.ItemTypeName == Item(itemId)))
                    row.Problems.Add(OversoldRow);
            }

            var broken = preview.Rows.Count(r => r.Problems.Any(p => p != OversoldRow));
            if (broken > 0)
                preview.BlockingErrors.Add($"{broken} row(s) cannot be applied as they stand. Each one says why.");

            preview.Unchanged = preview.Rows.Count(r => r.Action == GdRevisionActions.Unchanged);
            preview.Changed = changed.Count;
            preview.Added = added.Count;
            preview.Removed = removed.Count;
            preview.OldTotalCost = Money(consignment.Lines.Sum(l => l.CostExcludingTax));
            preview.OldTotalSellingValue = Money(consignment.Lines.Sum(l => l.SellingValueExcludingTax));
            preview.NewTotalCost = Money(revised.Sum(n => Money(n.Cost)));
            preview.NewTotalSellingValue = Money(revised.Sum(Selling));
            if (changed.Count + added.Count + removed.Count == 0 && preview.BlockingErrors.Count == 0)
                preview.Warnings.Add("The sheet matches the recorded GD. There is nothing to change.");
            return Done();
        }

        /// <summary>What the company holds of each item now: opening balances plus every movement.</summary>
        private async Task<Dictionary<int, decimal>> HeldAsync(int companyId, List<int> itemIds)
        {
            var opening = await _db.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId && itemIds.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new { g.Key, Qty = g.Sum(o => o.Quantity) }).ToListAsync();
            var moved = await _db.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId && itemIds.Contains(m.ItemTypeId))
                .GroupBy(m => m.ItemTypeId)
                .Select(g => new { g.Key, Qty = g.Sum(m => m.Direction == StockMovementDirection.In ? m.Quantity : -m.Quantity) })
                .ToListAsync();
            var held = itemIds.ToDictionary(i => i, _ => 0m);
            foreach (var o in opening) held[o.Key] += o.Qty;
            foreach (var m in moved) held[m.Key] += m.Qty;
            return held;
        }

        // -- Apply ---------------------------------------------------------------

        public async Task<GdRevisionResultDto> CommitAsync(int consignmentId, GdRevisionCommitDto dto, int userId)
        {
            var consignment = await _db.ImportConsignments
                .Include(c => c.Lines)
                .FirstOrDefaultAsync(c => c.Id == consignmentId)
                ?? throw new InvalidOperationException("That consignment no longer exists.");
            var companyId = consignment.CompanyId;

            // The plan is rebuilt here from the submitted lines against the GD as
            // it stands now, so a stale review cannot apply.
            var plan = await BuildPlanAsync(consignment, new GdCostingPreviewDto { Lines = dto.Lines ?? new() });
            if (plan.Preview.BlockingErrors.Count > 0)
                throw new InvalidOperationException(string.Join(" ", plan.Preview.BlockingErrors));
            if (plan.Changed.Count + plan.Added.Count + plan.Removed.Count == 0)
                throw new InvalidOperationException("The sheet matches the recorded GD. Nothing was changed.");

            var result = new GdRevisionResultDto
            {
                ConsignmentId = consignment.Id,
                GdNumber = consignment.GdNumber,
                OldTotalCost = plan.Preview.OldTotalCost,
            };
            var reason = string.IsNullOrWhiteSpace(dto.Reason) ? "GD revised from a sheet." : dto.Reason.Trim();
            var arrivalItems = new List<int>();

            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                // New lines first, so a line that lowers an item never sees it
                // short of stock the same revision brings.
                if (plan.Added.Count > 0)
                {
                    var commit = await _gdImport.CommitAsync(new GdCostingCommitDto
                    {
                        CompanyId = companyId,
                        ImportProfileId = dto.ImportProfileId,
                        ProfileVersion = dto.ProfileVersion,
                        FileSha256 = dto.FileSha256 ?? "",
                        FileName = dto.FileName ?? $"Revision of GD {consignment.GdNumber}",
                        FileSizeBytes = dto.FileSizeBytes,
                        Lines = plan.Added,
                        CreateMissingStock = true,
                        Mode = GdCostingImportModeNames.NewArrivals,
                    }, userId, appendToConsignmentId: consignment.Id);
                    arrivalItems = commit.ArrivalItemTypeIds;
                    result.LinesAdded = plan.Added.Count;
                }

                // Raises before cuts, for the same reason.
                foreach (var (old, n) in plan.Changed.OrderByDescending(p => p.New.Quantity - p.Old.Quantity))
                {
                    await _consignments.UpdateLineAsync(consignment.Id, old.Id, new UpdateImportConsignmentLineDto
                    {
                        Quantity = n.Quantity,
                        AssessedValue = n.AssessedValue,
                        CustomsDuty = n.CustomsDuty,
                        Acd = n.Acd,
                        RegulatoryDuty = n.RegulatoryDuty,
                        Others = n.Others,
                        SalesTaxRate = n.SalesTaxRate,
                        AstRate = n.AstRate,
                        IncomeTaxRate = n.IncomeTaxRate,
                        AddOnProfit = n.AddOnProfit,
                        SellingValueExcludingTax = n.SheetSellingValue,
                        DescriptionOnSheet = n.Description,
                        Reason = reason,
                    }, userId, partOfRevision: true);
                    result.LinesChanged++;
                }

                if (plan.Removed.Count > 0)
                {
                    var movementIds = plan.Removed.Where(l => l.StockMovementId.HasValue)
                        .Select(l => l.StockMovementId!.Value).ToList();
                    foreach (var line in plan.Removed) line.StockMovementId = null;
                    await _db.SaveChangesAsync();
                    await _db.StockMovements.Where(m => movementIds.Contains(m.Id)).ExecuteDeleteAsync();
                    _db.ImportConsignmentLines.RemoveRange(plan.Removed);
                    result.LinesRemoved = plan.Removed.Count;
                }
                await _db.SaveChangesAsync();

                // The last word, from the rows as they now are.
                var touched = plan.Changed.Select(p => p.Old.ItemTypeId).Concat(plan.Removed.Select(l => l.ItemTypeId))
                    .Where(i => i.HasValue).Select(i => i!.Value).Distinct().ToList();
                foreach (var (itemId, qty) in await HeldAsync(companyId, touched))
                    if (qty < -Epsilon)
                    {
                        var name = await _db.ItemTypes.Where(i => i.Id == itemId).Select(i => i.Name).FirstOrDefaultAsync();
                        throw new InvalidOperationException(
                            $"The revision would leave \"{name}\" holding less than nothing. Nothing was changed.");
                    }

                var lines = await _db.ImportConsignmentLines.Where(l => l.ImportConsignmentId == consignment.Id).ToListAsync();
                var costs = lines.Select(l => ImportCostingCalculator.Compute(new ImportCostingCalculator.ImportCostingInput(
                    l.AssessedValue, l.CustomsDuty, l.Acd, l.RegulatoryDuty, l.Others,
                    l.SalesTaxRate, l.AstRate, l.IncomeTaxRate, l.AddOnProfit))).ToList();
                consignment.TotalCostExcludingTax = Money(lines.Sum(l => l.CostExcludingTax));
                consignment.TotalSellingValue = Money(lines.Sum(l => l.SellingValueExcludingTax));
                consignment.TotalInputTax = Money(costs.Sum(c => c.InputTax));
                consignment.TotalIncomeTax = Money(costs.Sum(c => c.IncomeTax));
                await _db.SaveChangesAsync();

                // One re-post for the whole revision: the entry is rebuilt from
                // the lines, never patched.
                await _posting.RemoveForSourceAsync(companyId, SourceDocType.ImportConsignment, consignment.Id);
                await _posting.PostImportConsignmentAsync(consignment);
                if (consignment.AmountSettled > consignment.ImportClearingCredited + SettledEpsilon)
                    throw new InvalidOperationException(
                        $"The revision drops GD {consignment.GdNumber}'s liability to {consignment.ImportClearingCredited:N2}, "
                        + $"but {consignment.AmountSettled:N2} has already been settled against it. Reduce or cancel the settlement first.");
                await _db.SaveChangesAsync();
                await _posting.PostInventoryPeriodsAsync(companyId, null);

                _db.AuditLogs.Add(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Info",
                    CompanyId = companyId,
                    UserName = await _db.Users.Where(u => u.Id == userId).Select(u => u.Username).FirstOrDefaultAsync(),
                    HttpMethod = "POST",
                    RequestPath = $"/import-consignments/{consignment.Id}/revise/commit",
                    StatusCode = 200,
                    ExceptionType = "ImportConsignment.Revised",
                    Message = $"GD {consignment.GdNumber} revised from a sheet: {result.LinesChanged} line(s) changed, "
                            + $"{result.LinesAdded} added, {result.LinesRemoved} removed; landed cost "
                            + $"{result.OldTotalCost:N2} -> {consignment.TotalCostExcludingTax:N2}. {reason}",
                });
                await _db.SaveChangesAsync();
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            result.NewTotalCost = consignment.TotalCostExcludingTax;
            result.ImportClearingCredited = consignment.ImportClearingCredited;
            result.Messages.Add(
                $"GD {consignment.GdNumber}: {result.LinesChanged} line(s) changed, {result.LinesAdded} added, {result.LinesRemoved} removed.");
            result.Messages.Add($"Landed cost {result.OldTotalCost:N2} is now {result.NewTotalCost:N2}. The journal entry was re-posted.");

            // New arrivals dated inside a stock-sheet match are re-matched, as
            // the GD import itself does. The revision stands either way.
            if (arrivalItems.Count > 0)
            {
                try
                {
                    var userName = await _db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => u.Username).FirstOrDefaultAsync();
                    await _restatements.RestateLateGdsAsync(companyId, userId, userName, commit: true,
                        arrivalItems, $"/api/import-consignments/{consignment.Id}/revise/commit");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Company {CompanyId}: GD {Gd} was revised but its late-GD re-match was not applied.", companyId, consignment.GdNumber);
                }
            }

            _logger.LogInformation(
                "Revised consignment {Id} (GD {GdNumber}) in company {CompanyId}: {Changed} changed, {Added} added, {Removed} removed",
                consignment.Id, consignment.GdNumber, companyId, result.LinesChanged, result.LinesAdded, result.LinesRemoved);
            return result;
        }
    }
}
