using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <inheritdoc cref="IImportConsignmentService"/>
    public class ImportConsignmentService : IImportConsignmentService
    {
        private readonly AppDbContext _db;
        private readonly IPostingService _posting;
        private readonly IStockCostAuditService _costAudit;
        private readonly ILogger<ImportConsignmentService> _logger;

        public ImportConsignmentService(AppDbContext db, IPostingService posting,
            IStockCostAuditService costAudit, ILogger<ImportConsignmentService> logger)
        {
            _db = db;
            _posting = posting;
            _costAudit = costAudit;
            _logger = logger;
        }

        // ── List ─────────────────────────────────────────────────────────────

        /// <summary>Rounding noise floor for "is this Outstanding actually
        /// zero/positive" — the same 0.005 half-paisa tolerance
        /// <see cref="DTOs.ImportConsignmentSettlementStatusNames"/> uses, kept
        /// in step so the filter and the badge can never disagree about one
        /// row.</summary>
        private const decimal OutstandingEpsilon = 0.005m;

        public async Task<ImportConsignmentListResultDto> GetPagedAsync(
            int companyId, int page, int? pageSize, bool onlyOutstanding = false)
        {
            var size = PaginationHelper.Clamp(pageSize);
            var pageNo = PaginationHelper.ClampPage(page);

            // The company-wide headline: EVERY consignment, ignoring the page
            // and the onlyOutstanding filter, so it always ties to the same
            // figure the Import Clearing control account itself would report
            // (barring a manual journal posted straight to that account).
            var totalOutstanding = await _db.ImportConsignments.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .SumAsync(c => (decimal?)(c.ImportClearingCredited - c.AmountSettled)) ?? 0m;

            var q = _db.ImportConsignments.AsNoTracking().Where(c => c.CompanyId == companyId);
            if (onlyOutstanding)
                q = q.Where(c => c.ImportClearingCredited - c.AmountSettled > OutstandingEpsilon);
            var total = await q.CountAsync();

            // Default sort puts what is owed in front of the operator — an
            // importer opens this screen to answer "what do I still owe", not
            // to hunt for it across pages of already-settled rows.
            var rows = await q
                .OrderByDescending(c => c.ImportClearingCredited - c.AmountSettled > OutstandingEpsilon)
                .ThenByDescending(c => c.CreatedAt).ThenByDescending(c => c.Id)
                .Skip((pageNo - 1) * size).Take(size)
                .Select(c => new
                {
                    c.Id,
                    c.GdNumber,
                    c.GdDate,
                    c.TotalCostExcludingTax,
                    c.TotalInputTax,
                    c.TotalIncomeTax,
                    c.TotalSellingValue,
                    c.Mode,
                    c.ImportRunId,
                    c.CreatedAt,
                    c.ImportClearingCredited,
                    c.AmountSettled,
                    LineCount = c.Lines.Count(),
                })
                .ToListAsync();

            // Batched joins rather than one row at a time — this is a LIST.
            var runIds = rows.Where(r => r.ImportRunId.HasValue).Select(r => r.ImportRunId!.Value).Distinct().ToList();
            var runs = runIds.Count == 0
                ? new Dictionary<int, ImportRun>()
                : await _db.ImportRuns.AsNoTracking().Where(r => runIds.Contains(r.Id)).ToDictionaryAsync(r => r.Id);

            var userIds = runs.Values.Select(r => r.ImportedByUserId).Distinct().ToList();
            var userNames = userIds.Count == 0
                ? new Dictionary<int, string>()
                : await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
                    .ToDictionaryAsync(u => u.Id, u => string.IsNullOrWhiteSpace(u.FullName) ? u.Username : u.FullName);

            var consignmentIds = rows.Select(r => r.Id).ToList();
            var withJournal = consignmentIds.Count == 0
                ? new HashSet<int>()
                : (await _db.JournalEntries.AsNoTracking()
                    .Where(e => e.CompanyId == companyId && e.SourceDocType == SourceDocType.ImportConsignment
                             && e.SourceDocId.HasValue && consignmentIds.Contains(e.SourceDocId.Value))
                    .Select(e => e.SourceDocId!.Value)
                    .ToListAsync())
                    .ToHashSet();

            var items = rows.Select(r =>
            {
                ImportRun? run = r.ImportRunId.HasValue && runs.TryGetValue(r.ImportRunId.Value, out var rr) ? rr : null;
                return new ImportConsignmentListItemDto
                {
                    Id = r.Id,
                    GdNumber = r.GdNumber,
                    GdDate = r.GdDate,
                    LineCount = r.LineCount,
                    TotalCostExcludingTax = r.TotalCostExcludingTax,
                    TotalInputTax = r.TotalInputTax,
                    TotalIncomeTax = r.TotalIncomeTax,
                    TotalSellingValue = r.TotalSellingValue,
                    Mode = GdCostingImportModeNames.Normalize(r.Mode),
                    ImportedAt = run?.ImportedAt ?? r.CreatedAt,
                    ImportedByUserName = run != null && userNames.TryGetValue(run.ImportedByUserId, out var name) ? name : null,
                    HasJournalEntry = withJournal.Contains(r.Id),
                    ImportClearingCredited = r.ImportClearingCredited,
                    AmountSettled = r.AmountSettled,
                    SettlementStatus = ImportConsignmentSettlementStatusNames.Resolve(r.ImportClearingCredited, r.AmountSettled),
                };
            }).ToList();

            return new ImportConsignmentListResultDto
            {
                Items = items,
                TotalCount = total,
                Page = pageNo,
                PageSize = size,
                TotalOutstanding = totalOutstanding,
            };
        }

        // ── Detail ───────────────────────────────────────────────────────────

        public async Task<ImportConsignmentDetailDto?> GetDetailAsync(int id)
        {
            var c = await _db.ImportConsignments.AsNoTracking()
                .Include(x => x.Lines)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (c == null) return null;

            var itemTypeIds = c.Lines.Where(l => l.ItemTypeId.HasValue).Select(l => l.ItemTypeId!.Value).Distinct().ToList();
            var itemTypeNames = itemTypeIds.Count == 0
                ? new Dictionary<int, string>()
                : await _db.ItemTypes.AsNoTracking().Where(it => itemTypeIds.Contains(it.Id))
                    .ToDictionaryAsync(it => it.Id, it => it.Name);

            DateTime importedAt = c.CreatedAt;
            string? importedByUserName = null;
            if (c.ImportRunId.HasValue)
            {
                var run = await _db.ImportRuns.AsNoTracking().FirstOrDefaultAsync(r => r.Id == c.ImportRunId.Value);
                if (run != null)
                {
                    importedAt = run.ImportedAt;
                    var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == run.ImportedByUserId);
                    if (user != null)
                        importedByUserName = string.IsNullOrWhiteSpace(user.FullName) ? user.Username : user.FullName;
                }
            }

            var je = await _db.JournalEntries.AsNoTracking().FirstOrDefaultAsync(e =>
                e.CompanyId == c.CompanyId && e.SourceDocType == SourceDocType.ImportConsignment && e.SourceDocId == c.Id);

            // Every non-cancelled payment settled against this consignment —
            // the "which GD unpaid" drill-down. Mirrors how AmountSettled
            // itself is recomputed (PaymentService.RecomputeImportConsignmentAsync):
            // same non-cancelled filter, so the total above and this list can
            // never disagree about what counts. Reference is formatted after
            // materialising — a ":D4" format string cannot translate to SQL.
            var settlementRows = await _db.PaymentAllocations.AsNoTracking()
                .Where(a => a.ImportConsignmentId == c.Id && !a.Payment.IsCancelled)
                .OrderByDescending(a => a.Payment.Date).ThenByDescending(a => a.PaymentId)
                .Select(a => new { a.PaymentId, a.Payment.Date, a.Payment.Number, a.Amount, a.AdjustmentAmount })
                .ToListAsync();
            var settlements = settlementRows.Select(r => new ImportConsignmentSettlementDto
            {
                PaymentId = r.PaymentId,
                Date = r.Date,
                Reference = $"PMT-{r.Number:D4}",
                Amount = r.Amount + r.AdjustmentAmount,
            }).ToList();

            return new ImportConsignmentDetailDto
            {
                Id = c.Id,
                CompanyId = c.CompanyId,
                GdNumber = c.GdNumber,
                GdDate = c.GdDate,
                TotalCostExcludingTax = c.TotalCostExcludingTax,
                TotalInputTax = c.TotalInputTax,
                TotalIncomeTax = c.TotalIncomeTax,
                TotalSellingValue = c.TotalSellingValue,
                Mode = GdCostingImportModeNames.Normalize(c.Mode),
                Notes = c.Notes,
                ImportedAt = importedAt,
                ImportedByUserName = importedByUserName,
                HasJournalEntry = je != null,
                JournalEntryId = je?.Id,
                ImportClearingCredited = c.ImportClearingCredited,
                AmountSettled = c.AmountSettled,
                SettlementStatus = ImportConsignmentSettlementStatusNames.Resolve(c.ImportClearingCredited, c.AmountSettled),
                Settlements = settlements,
                Lines = c.Lines
                    .OrderBy(l => l.SourceRow)
                    .Select(l => new ImportConsignmentLineDetailDto
                    {
                        Id = l.Id,
                        SourceRow = l.SourceRow,
                        DescriptionOnSheet = l.DescriptionOnSheet,
                        HsCode = l.HsCode,
                        Quantity = l.Quantity,
                        Unit = l.Unit,
                        AssessedValue = l.AssessedValue,
                        CustomsDuty = l.CustomsDuty,
                        Acd = l.Acd,
                        RegulatoryDuty = l.RegulatoryDuty,
                        Others = l.Others,
                        SalesTaxRate = l.SalesTaxRate,
                        AstRate = l.AstRate,
                        IncomeTaxRate = l.IncomeTaxRate,
                        AddOnProfit = l.AddOnProfit,
                        CostExcludingTax = l.CostExcludingTax,
                        SellingValueExcludingTax = l.SellingValueExcludingTax,
                        Disposition = GdCostingDispositionNames.From(l.Disposition),
                        DispositionNote = l.DispositionNote,
                        ItemTypeName = l.ItemTypeId.HasValue && itemTypeNames.TryGetValue(l.ItemTypeId.Value, out var n) ? n : null,
                    })
                    .ToList(),
            };
        }

        // ── Delete (the correction path) ────────────────────────────────────

        /// <summary>
        /// See the interface doc comment for the contract. Two passes on
        /// purpose: pass 1 (below) VALIDATES every reversal and THROWS before
        /// anything is mutated if any part of it cannot be done safely; pass 2
        /// applies the now-proven-safe changes and calls SaveChanges exactly
        /// once. A refusal midway through pass 1 therefore leaves the
        /// consignment completely untouched — never a half-undo.
        /// </summary>
        public async Task<ImportConsignmentDeleteResultDto> DeleteAsync(int id, int userId)
        {
            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                var consignment = await _db.ImportConsignments
                    .Include(c => c.Lines)
                    .FirstOrDefaultAsync(c => c.Id == id);
                if (consignment == null)
                    throw new InvalidOperationException("That consignment no longer exists.");

                var companyId = consignment.CompanyId;
                var mode = GdCostingImportModeNames.Normalize(consignment.Mode);
                var result = new ImportConsignmentDeleteResultDto { GdNumber = consignment.GdNumber };

                // ── Pass 1 (Task 23): a consignment with any settlement against
                // it cannot be undone — unwinding it would strand the payment
                // that part- or fully-paid its liability, with nothing left for
                // that payment to point at. Cancelled payments don't count
                // (same filter AmountSettled itself uses), so a payment that was
                // cancelled first no longer blocks the delete.
                var settlingPayments = await _db.PaymentAllocations.AsNoTracking()
                    .Where(a => a.ImportConsignmentId == consignment.Id && !a.Payment.IsCancelled)
                    .Select(a => new { a.Payment.Number })
                    .Distinct()
                    .ToListAsync();
                if (settlingPayments.Count > 0)
                {
                    var refs = string.Join(", ", settlingPayments
                        .Select(p => $"PMT-{p.Number:D4}")
                        .OrderBy(r => r, StringComparer.Ordinal));
                    throw new InvalidOperationException(
                        $"Cannot delete: GD {consignment.GdNumber} has been settled against by {settlingPayments.Count} payment(s) ({refs}). " +
                        "Delete or cancel those payments first, or leave this consignment in place.");
                }

                // ── Pass 1a: StockPosted lines — balances THIS consignment
                // created. Deletable only if nothing else now depends on them.
                var stockPostedBalanceIds = consignment.Lines
                    .Where(l => l.Disposition == GdCostingDisposition.StockPosted && l.OpeningStockBalanceId.HasValue)
                    .Select(l => l.OpeningStockBalanceId!.Value)
                    .Distinct()
                    .ToList();

                var balancesToDelete = new List<OpeningStockBalance>();
                foreach (var balanceId in stockPostedBalanceIds)
                {
                    var balance = await _db.OpeningStockBalances.Include(b => b.ItemType)
                        .FirstOrDefaultAsync(b => b.Id == balanceId);
                    if (balance == null) continue; // already gone somehow -- nothing left to undo for it

                    var itemName = balance.ItemType?.Name ?? $"item #{balance.ItemTypeId}";

                    // Another consignment's line (this one's own sibling lines
                    // pointing at the SAME balance are fine -- they are being
                    // removed together) still points at this balance: it is not
                    // this delete's alone to remove.
                    var otherLineExists = await _db.ImportConsignmentLines.AnyAsync(l =>
                        l.OpeningStockBalanceId == balanceId && l.ImportConsignmentId != consignment.Id);
                    if (otherLineExists)
                        throw new InvalidOperationException(
                            $"Cannot delete: the opening balance this consignment created for \"{itemName}\" is also relied on by another consignment. Delete that one first, or leave this one in place.");

                    // A brand-new balance this import created starts with NO
                    // stock movements of its own (CreateMissingStockAsync
                    // deliberately writes none) and no opening-stock lots
                    // (only the spreadsheet importer writes those). ANY of
                    // either found now happened AFTER this consignment, and
                    // deleting the balance would destroy that history.
                    var hasMoved = await _db.StockMovements.AnyAsync(m =>
                        m.CompanyId == companyId && m.ItemTypeId == balance.ItemTypeId);
                    if (hasMoved)
                        throw new InvalidOperationException(
                            $"Cannot delete: \"{itemName}\" has stock movements recorded since this consignment created it (sold, adjusted, purchased, or otherwise moved). Remove those first, or leave this consignment in place.");

                    var hasLots = await _db.OpeningStockLots.AnyAsync(l => l.OpeningStockBalanceId == balanceId);
                    if (hasLots)
                        throw new InvalidOperationException(
                            $"Cannot delete: \"{itemName}\" has since been given opening-stock detail by a spreadsheet import. Remove those first, or leave this consignment in place.");

                    balancesToDelete.Add(balance);
                }

                // ── Pass 1b: CostOnly lines — balances this consignment
                // costed, never deleted, only the cost (and, in New Arrivals
                // mode, quantity/value) contribution reversed.
                var costOnlyLines = consignment.Lines
                    .Where(l => l.Disposition == GdCostingDisposition.CostOnly && l.OpeningStockBalanceId.HasValue)
                    .ToList();
                var costOnlyBalanceIds = costOnlyLines.Select(l => l.OpeningStockBalanceId!.Value).Distinct().ToList();

                // balanceId -> (balance, new quantity/cost/value to apply). Computed
                // up front so a negative result can refuse the WHOLE delete before
                // anything is written, exactly like the StockPosted checks above.
                var costReversals = new List<(OpeningStockBalance Balance, decimal Qty, decimal Cost, decimal Value)>();
                foreach (var balanceId in costOnlyBalanceIds)
                {
                    var balance = await _db.OpeningStockBalances.Include(b => b.ItemType)
                        .FirstOrDefaultAsync(b => b.Id == balanceId);
                    if (balance == null) continue; // nothing left to reverse it onto

                    var linesForBalance = costOnlyLines.Where(l => l.OpeningStockBalanceId == balanceId).ToList();

                    if (mode == GdCostingImportModeNames.NewArrivals)
                    {
                        // New Arrivals ADDED quantity, cost and selling value
                        // onto the balance -- reversal SUBTRACTS exactly what
                        // this consignment's own lines contributed.
                        var totalQty = linesForBalance.Sum(l => l.Quantity);
                        var totalCost = linesForBalance.Sum(l => l.CostExcludingTax);
                        var totalValue = linesForBalance.Sum(l => l.SellingValueExcludingTax);

                        var newQty = balance.Quantity - totalQty;
                        var newCost = Money(balance.ActualCostExcludingTax - totalCost);
                        var newValue = Money(balance.ValueExcludingTax - totalValue);

                        // Something else has since reduced this balance below
                        // what this consignment added -- undoing it honestly
                        // would take quantity, cost or value negative. Refuse
                        // rather than invent an impossible position (the same
                        // invariant StockValuation/Helpers/StockController's
                        // adjust endpoint already enforce everywhere else).
                        if (newQty < 0 || newCost < 0 || newValue < 0)
                            throw new InvalidOperationException(
                                $"Cannot delete: reversing what this consignment added to \"{balance.ItemType?.Name ?? $"item #{balance.ItemTypeId}"}\" would take its quantity, cost or value negative -- something else has already reduced it below what this consignment brought in.");

                        costReversals.Add((balance, newQty, newCost, newValue));
                    }
                    else
                    {
                        // Backfill SET the cost from this GD's own unit cost --
                        // there is no stored prior value anywhere to restore, so
                        // the honest reversal is 0, not a guess. Quantity and
                        // value were never touched by Backfill, so they are left
                        // exactly as they are.
                        costReversals.Add((balance, balance.Quantity, 0m, balance.ValueExcludingTax));
                    }
                }

                // ── Everything above is proven safe. Now actually do it. ──

                var hadJournalEntry = await _db.JournalEntries.AnyAsync(e =>
                    e.CompanyId == companyId && e.SourceDocType == SourceDocType.ImportConsignment && e.SourceDocId == consignment.Id);
                await _posting.RemoveForSourceAsync(companyId, SourceDocType.ImportConsignment, consignment.Id);
                result.JournalEntryWithdrawn = hadJournalEntry;

                foreach (var (balance, qty, cost, value) in costReversals)
                {
                    // Recorded from the row's CURRENT figures, before they are
                    // overwritten -- an undo is a cost change like any other,
                    // and Backfill's reversal to 0 is the one an operator is
                    // most likely to come back asking about.
                    await _costAudit.RecordAsync(
                        companyId, balance.ItemTypeId, balance.Id, userId,
                        StockCostChangeSources.ConsignmentDelete, consignment.GdNumber,
                        new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax),
                        new StockFigures(qty, cost, value),
                        note: mode == GdCostingImportModeNames.NewArrivals
                            ? $"Consignment deleted: this GD's New Arrivals quantity, cost and value were subtracted back out."
                            : "Consignment deleted: Backfill SET the cost, so there was no prior figure to restore and it reset to 0.00.",
                        importConsignmentId: consignment.Id);

                    balance.Quantity = qty;
                    balance.ActualCostExcludingTax = cost;
                    balance.ValueExcludingTax = value;
                }
                result.BalancesCostReversed = costReversals.Count;

                _db.ImportConsignmentLines.RemoveRange(consignment.Lines);
                _db.ImportConsignments.Remove(consignment);

                foreach (var balance in balancesToDelete)
                {
                    // The audit row keeps OpeningStockBalanceId as a PLAIN
                    // column precisely so it can outlive the balance it names
                    // (see the model) -- otherwise the item that vanished would
                    // be the one item with no history explaining why.
                    await _costAudit.RecordAsync(
                        companyId, balance.ItemTypeId, balance.Id, userId,
                        StockCostChangeSources.ConsignmentDelete, consignment.GdNumber,
                        new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax),
                        new StockFigures(0m, 0m, 0m),
                        note: "Consignment deleted: the opening balance this import created was removed with it.",
                        importConsignmentId: consignment.Id);
                    _db.OpeningStockBalances.Remove(balance);
                }
                result.BalancesDeleted = balancesToDelete.Count;

                await _db.SaveChangesAsync();
                await tx.CommitAsync();

                if (result.BalancesCostReversed > 0)
                    result.Messages.Add(mode == GdCostingImportModeNames.NewArrivals
                        ? $"{result.BalancesCostReversed} opening balance(s) had this consignment's New Arrivals quantity, cost and value subtracted back out."
                        : $"{result.BalancesCostReversed} opening balance(s) had their actual cost reset to 0.00 -- Backfill mode SET the cost, so there was no prior figure to restore.");
                if (result.BalancesDeleted > 0)
                    result.Messages.Add($"{result.BalancesDeleted} opening balance(s) created by this consignment were removed.");
                if (result.JournalEntryWithdrawn)
                    result.Messages.Add("The journal entry posted for this consignment was withdrawn.");

                _logger.LogInformation(
                    "Deleted GD costing consignment {Id} (GD {GdNumber}) from company {CompanyId}: {CostReversed} balance(s) cost-reversed, {Deleted} balance(s) deleted, journal entry withdrawn: {JeWithdrawn}",
                    id, consignment.GdNumber, companyId, result.BalancesCostReversed, result.BalancesDeleted, result.JournalEntryWithdrawn);

                return result;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }


        // -- Correct one line (the surgical alternative to delete-and-reimport) --

        /// <summary>
        /// See the interface for the contract. Same two-pass shape as
        /// <see cref="DeleteAsync"/>: pass 1 recomputes and validates every
        /// consequence, pass 2 applies them. A refusal in pass 1 leaves the
        /// consignment exactly as it was.
        /// </summary>
        public async Task<ImportConsignmentLineUpdateResultDto> UpdateLineAsync(
            int consignmentId, int lineId, UpdateImportConsignmentLineDto dto, int userId)
        {
            await using var tx = await _db.Database.BeginTransactionAsync();
            try
            {
                var consignment = await _db.ImportConsignments
                    .Include(c => c.Lines)
                    .FirstOrDefaultAsync(c => c.Id == consignmentId);
                if (consignment == null)
                    throw new InvalidOperationException("That consignment no longer exists.");

                var line = consignment.Lines.FirstOrDefault(l => l.Id == lineId)
                    ?? throw new InvalidOperationException("That line does not belong to this consignment.");

                var companyId = consignment.CompanyId;
                var mode = GdCostingImportModeNames.Normalize(consignment.Mode);
                var result = new ImportConsignmentLineUpdateResultDto
                {
                    GdNumber = consignment.GdNumber,
                    LineId = line.Id,
                    OldCostExcludingTax = line.CostExcludingTax,
                    OldSellingValueExcludingTax = line.SellingValueExcludingTax,
                };

                // -- Pass 1a: the submitted figures have to be figures. --
                if (dto.Quantity <= 0m)
                    throw new InvalidOperationException("Give the quantity this line covers - a costed line cannot be for nothing.");
                if (dto.AssessedValue < 0m || dto.CustomsDuty < 0m || dto.Acd < 0m
                    || dto.RegulatoryDuty < 0m || dto.Others < 0m || dto.AddOnProfit < 0m)
                    throw new InvalidOperationException("Assessed value, duties, other charges and add-on profit cannot be negative.");
                if (dto.SalesTaxRate is < 0m or > 100m || dto.AstRate is < 0m or > 100m
                    || dto.IncomeTaxRate is < 0m or > 100m)
                    throw new InvalidOperationException("Every rate is a percentage between 0 and 100.");
                if (dto.SellingValueExcludingTax is < 0m)
                    throw new InvalidOperationException("A selling value cannot be negative.");

                // -- Pass 1b: SERVER-side costing, never the caller's arithmetic
                // (the same rule a1b4406 established for the commit path). --
                var computed = ImportCostingCalculator.Compute(new ImportCostingCalculator.ImportCostingInput(
                    AssessedValue: dto.AssessedValue,
                    CustomsDuty: dto.CustomsDuty,
                    Acd: dto.Acd,
                    RegulatoryDuty: dto.RegulatoryDuty,
                    Others: dto.Others,
                    SalesTaxRate: dto.SalesTaxRate,
                    AstRate: dto.AstRate,
                    IncomeTaxRate: dto.IncomeTaxRate,
                    AddOnProfit: dto.AddOnProfit));

                var newCost = Money(computed.Cost);
                var newSelling = dto.SellingValueExcludingTax.HasValue
                    ? Money(dto.SellingValueExcludingTax.Value)
                    : Money(computed.SellingValue);

                var deltaQty = dto.Quantity - line.Quantity;
                var deltaCost = Money(newCost - line.CostExcludingTax);
                var deltaSelling = Money(newSelling - line.SellingValueExcludingTax);

                // -- Pass 1c: what this does to the balance the line feeds. --
                OpeningStockBalance? balance = null;
                decimal newBalQty = 0m, newBalCost = 0m, newBalValue = 0m;

                var balanceId = line.OpeningStockBalanceId ?? 0;
                if (balanceId > 0)
                {
                    balance = await _db.OpeningStockBalances.Include(b => b.ItemType)
                        .FirstOrDefaultAsync(b => b.Id == balanceId);
                }

                if (balance != null)
                {
                    var itemName = balance.ItemType?.Name ?? $"item #{balance.ItemTypeId}";

                    if (mode == GdCostingImportModeNames.Backfill
                        && line.Disposition == GdCostingDisposition.CostOnly)
                    {
                        // Backfill SET the cost as (this consignment's pooled
                        // unit cost for this balance) x (the balance's whole
                        // quantity). Re-derive the pool from ALL of this
                        // consignment's cost-only lines against this balance,
                        // with the corrected figures standing in for this one --
                        // byte-for-byte the commit's own formula, so a
                        // correction and a re-import land on the same number.
                        // Applying a delta instead would be wrong: the stored
                        // cost is not a sum of the lines, it is a rate applied
                        // to a different quantity.
                        var siblings = consignment.Lines.Where(l =>
                            l.Disposition == GdCostingDisposition.CostOnly
                            && l.OpeningStockBalanceId == balanceId).ToList();
                        var totalCost = siblings.Sum(l => l.Id == line.Id ? newCost : l.CostExcludingTax);
                        var totalQty = siblings.Sum(l => l.Id == line.Id ? dto.Quantity : l.Quantity);
                        var unitCost = totalQty != 0m ? totalCost / totalQty : 0m;

                        newBalQty = balance.Quantity;                       // Backfill never moved it
                        newBalValue = balance.ValueExcludingTax;            // nor this
                        newBalCost = Math.Round(unitCost * balance.Quantity, 2, MidpointRounding.AwayFromZero);
                    }
                    else
                    {
                        // New Arrivals (added qty/cost/value) and StockPosted
                        // (created the balance FROM the lines) both accumulate,
                        // so the honest correction is the delta -- which also
                        // leaves anything that has happened to the balance
                        // since untouched.
                        newBalQty = balance.Quantity + deltaQty;
                        newBalCost = Money(balance.ActualCostExcludingTax + deltaCost);
                        newBalValue = Money(balance.ValueExcludingTax + deltaSelling);
                    }

                    if (newBalQty < 0m || newBalCost < 0m || newBalValue < 0m)
                        throw new InvalidOperationException(
                            $"That correction would take \"{itemName}\" to a negative quantity, cost or value. "
                            + "Something else has already reduced it below what this line brought in - "
                            + "adjust the stock first, or delete and re-import the consignment.");
                }

                // -- Everything above is proven safe. Now actually do it. --

                line.Quantity = dto.Quantity;
                line.AssessedValue = Money(dto.AssessedValue);
                line.CustomsDuty = Money(dto.CustomsDuty);
                line.Acd = Money(dto.Acd);
                line.RegulatoryDuty = Money(dto.RegulatoryDuty);
                line.Others = Money(dto.Others);
                line.SalesTaxRate = dto.SalesTaxRate;
                line.AstRate = dto.AstRate;
                line.IncomeTaxRate = dto.IncomeTaxRate;
                line.AddOnProfit = Money(dto.AddOnProfit);
                line.CostExcludingTax = newCost;
                line.SellingValueExcludingTax = newSelling;
                var relabel = (dto.DescriptionOnSheet ?? "").Trim();
                if (relabel.Length > 0)
                    line.DescriptionOnSheet = relabel.Length <= 300 ? relabel : relabel[..300];

                result.NewCostExcludingTax = newCost;
                result.NewSellingValueExcludingTax = newSelling;

                if (balance != null)
                {
                    await _costAudit.RecordAsync(
                        companyId, balance.ItemTypeId, balance.Id, userId,
                        StockCostChangeSources.GdLineCorrection, consignment.GdNumber,
                        new StockFigures(balance.Quantity, balance.ActualCostExcludingTax, balance.ValueExcludingTax),
                        new StockFigures(newBalQty, newBalCost, newBalValue),
                        note: $"GD line corrected: landed cost {newCost:N2} "
                            + $"(was {result.OldCostExcludingTax:N2}), selling value {newSelling:N2} "
                            + $"(was {result.OldSellingValueExcludingTax:N2})."
                            + (string.IsNullOrWhiteSpace(dto.Reason) ? "" : $" {dto.Reason.Trim()}"),
                        importConsignmentId: consignment.Id);

                    balance.Quantity = newBalQty;
                    balance.ActualCostExcludingTax = newBalCost;
                    balance.ValueExcludingTax = newBalValue;
                    result.BalancesUpdated = 1;
                }

                // The header totals are the sheet's own, so they move with the
                // lines they summarise -- otherwise the Consignments screen would
                // keep showing the figure that was corrected away.
                consignment.TotalCostExcludingTax = Money(consignment.Lines.Sum(l => l.CostExcludingTax));
                consignment.TotalSellingValue = Money(consignment.Lines.Sum(l => l.SellingValueExcludingTax));

                // Persist BEFORE re-posting: PostImportConsignmentAsync reads the
                // lines back with AsNoTracking(), so an unsaved correction would
                // post the OLD figures and leave the ledger disagreeing with the
                // consignment it was posted from.
                await _db.SaveChangesAsync();

                var hadJournalEntry = await _db.JournalEntries.AnyAsync(e =>
                    e.CompanyId == companyId && e.SourceDocType == SourceDocType.ImportConsignment
                    && e.SourceDocId == consignment.Id);
                if (hadJournalEntry)
                {
                    // Withdraw and re-post rather than patch: the entry is
                    // idempotent on (CompanyId, SourceDocType, SourceDocId), and
                    // re-posting is the one code path that knows how a
                    // consignment decomposes into legs.
                    await _posting.RemoveForSourceAsync(companyId, SourceDocType.ImportConsignment, consignment.Id);
                    await _posting.PostImportConsignmentAsync(consignment);
                    result.JournalEntryReposted = true;

                    // A correction that lowers the liability below what has
                    // already been paid against it would leave the GD settled
                    // for more than it ever owed. Refused HERE, after the
                    // re-post has told us the new figure, and rolled back whole.
                    if (consignment.AmountSettled > consignment.ImportClearingCredited + OutstandingEpsilon)
                        throw new InvalidOperationException(
                            $"That correction drops GD {consignment.GdNumber}'s liability to "
                            + $"{consignment.ImportClearingCredited:N2}, but {consignment.AmountSettled:N2} has already been "
                            + "settled against it. Reduce or cancel the settlement first.");
                }
                result.ImportClearingCredited = consignment.ImportClearingCredited;

                await _db.SaveChangesAsync();
                await tx.CommitAsync();

                if (result.BalancesUpdated > 0)
                    result.Messages.Add(mode == GdCostingImportModeNames.Backfill
                        ? "The opening balance's actual cost was re-derived from this GD's corrected unit cost."
                        : "The opening balance had the difference applied to its quantity, cost and selling value.");
                if (result.JournalEntryReposted)
                    result.Messages.Add($"The journal entry was re-posted; Import Clearing now carries {result.ImportClearingCredited:N2}.");
                if (result.Messages.Count == 0)
                    result.Messages.Add("The line was corrected. It matched no stock, so nothing else moved.");

                _logger.LogInformation(
                    "Corrected line {LineId} of consignment {Id} (GD {GdNumber}) in company {CompanyId}: cost {OldCost} -> {NewCost}, reposted: {Reposted}",
                    lineId, consignmentId, consignment.GdNumber, companyId,
                    result.OldCostExcludingTax, result.NewCostExcludingTax, result.JournalEntryReposted);

                return result;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }
}
