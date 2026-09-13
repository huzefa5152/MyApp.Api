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
        private readonly ILogger<ImportConsignmentService> _logger;

        public ImportConsignmentService(AppDbContext db, IPostingService posting, ILogger<ImportConsignmentService> logger)
        {
            _db = db;
            _posting = posting;
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
                    balance.Quantity = qty;
                    balance.ActualCostExcludingTax = cost;
                    balance.ValueExcludingTax = value;
                }
                result.BalancesCostReversed = costReversals.Count;

                _db.ImportConsignmentLines.RemoveRange(consignment.Lines);
                _db.ImportConsignments.Remove(consignment);

                foreach (var balance in balancesToDelete)
                    _db.OpeningStockBalances.Remove(balance);
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

        private static decimal Money(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
    }
}
