namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire vocabulary for a consignment's Import Clearing settlement state
    /// (Task 23) — computed server-side from
    /// <see cref="Models.ImportConsignment.ImportClearingCredited"/> and
    /// <see cref="Models.ImportConsignment.AmountSettled"/>, never stored.
    /// </summary>
    public static class ImportConsignmentSettlementStatusNames
    {
        /// <summary>Nothing was ever credited to Import Clearing for this
        /// consignment — a Backfill import (never posts), or a New Arrivals
        /// import committed while the ledger was off. There is no liability to
        /// settle, so this is not "Unpaid".</summary>
        public const string NotPosted = "not-posted";

        /// <summary>Credited, and nothing has been settled against it yet.</summary>
        public const string Unpaid = "unpaid";

        /// <summary>Some, but not all, of the credited amount has been settled.</summary>
        public const string PartPaid = "part-paid";

        /// <summary>Settled in full — Outstanding is (within rounding) zero.</summary>
        public const string Settled = "settled";

        /// <summary>Same tolerance the codebase uses throughout for "this money
        /// figure is effectively zero" (paisa-level rounding noise).</summary>
        private const decimal Epsilon = 0.005m;

        public static string Resolve(decimal credited, decimal settled)
        {
            if (credited <= 0m) return NotPosted;
            var outstanding = credited - settled;
            if (outstanding <= Epsilon) return Settled;
            if (settled > Epsilon) return PartPaid;
            return Unpaid;
        }
    }

    /// <summary>
    /// One row of the paged consignment list — <c>GET /api/import-consignments</c>
    /// (Task 21). The counterpart read side of <see cref="GdCostingCommitResultDto"/>:
    /// a consignment is written once by a commit and, until this DTO existed, was
    /// then unreachable — the permission
    /// (<c>importcosting.consignments.view</c>) had no endpoint behind it.
    /// </summary>
    public class ImportConsignmentListItemDto
    {
        public int Id { get; set; }
        public string GdNumber { get; set; } = "";
        public DateTime GdDate { get; set; }
        public int LineCount { get; set; }
        public decimal TotalCostExcludingTax { get; set; }
        public decimal TotalInputTax { get; set; }
        public decimal TotalIncomeTax { get; set; }
        public decimal TotalSellingValue { get; set; }

        /// <summary>One of <see cref="GdCostingImportModeNames"/> — "backfill"
        /// or "new-arrivals".</summary>
        public string Mode { get; set; } = GdCostingImportModeNames.Backfill;

        /// <summary>When this consignment was written. Falls back to
        /// <c>ImportConsignment.CreatedAt</c> when the <c>ImportRun</c> that
        /// wrote it has since been deleted.</summary>
        public DateTime ImportedAt { get; set; }

        /// <summary>Null when the importing run (or its user) no longer exists.</summary>
        public string? ImportedByUserName { get; set; }

        /// <summary>Whether this consignment has a journal entry posted for it
        /// (New Arrivals mode, GL enabled, at least one costed line). Shown as
        /// a badge on the list — the main reason an operator would want to know
        /// before deleting one.</summary>
        public bool HasJournalEntry { get; set; }

        // ── Import Clearing subledger (Task 23) ─────────────────────────────

        /// <summary>What this consignment credited to Import Clearing when it
        /// posted. 0 for Backfill, or for New Arrivals committed with the
        /// ledger off — see <see cref="Models.ImportConsignment.ImportClearingCredited"/>.</summary>
        public decimal ImportClearingCredited { get; set; }

        /// <summary>Σ non-cancelled payments settled against this consignment.</summary>
        public decimal AmountSettled { get; set; }

        /// <summary>Credited − Settled. Never negative in practice — the
        /// over-settle guard refuses anything that would make it so.</summary>
        public decimal Outstanding => ImportClearingCredited - AmountSettled;

        /// <summary>One of <see cref="ImportConsignmentSettlementStatusNames"/>.</summary>
        public string SettlementStatus { get; set; } = ImportConsignmentSettlementStatusNames.NotPosted;
    }

    /// <summary>Paged consignment list PLUS the company-wide settlement
    /// headline (Task 23) — a plain hand-rolled shape rather than
    /// <c>PagedResult&lt;T&gt;</c> because <see cref="TotalOutstanding"/> must
    /// reflect EVERY consignment for the company, never just the current page
    /// or filter, so the screen's total always ties to the same figure the
    /// Import Clearing control account itself would report.</summary>
    public class ImportConsignmentListResultDto
    {
        public List<ImportConsignmentListItemDto> Items { get; set; } = new();
        public int TotalCount { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }
        public int TotalPages => PageSize <= 0 ? 0 : (int)Math.Ceiling((double)TotalCount / PageSize);

        /// <summary>Σ Outstanding across every consignment this company has —
        /// unaffected by paging or the <c>onlyOutstanding</c> filter.</summary>
        public decimal TotalOutstanding { get; set; }
    }

    /// <summary>One payment settled against a consignment — the detail view's
    /// "which GD unpaid" drill-down (Task 23).</summary>
    public class ImportConsignmentSettlementDto
    {
        public int PaymentId { get; set; }
        public DateTime Date { get; set; }
        /// <summary>"PMT-####".</summary>
        public string Reference { get; set; } = "";
        public decimal Amount { get; set; }
    }

    /// <summary>One line of a consignment's detail view. Mirrors
    /// <see cref="ImportConsignmentLine"/>, except the item type it resolved to
    /// is a NAME, never the raw id — CLAUDE.md's own rule for every operator-
    /// facing surface ("an operator must never be shown an internal row id").</summary>
    public class ImportConsignmentLineDetailDto
    {
        public int Id { get; set; }
        public int SourceRow { get; set; }
        public string DescriptionOnSheet { get; set; } = "";
        public string? HsCode { get; set; }
        public decimal Quantity { get; set; }
        public string? Unit { get; set; }

        public decimal AssessedValue { get; set; }
        public decimal CustomsDuty { get; set; }
        public decimal Acd { get; set; }
        public decimal RegulatoryDuty { get; set; }
        public decimal Others { get; set; }
        public decimal SalesTaxRate { get; set; }
        public decimal AstRate { get; set; }
        public decimal IncomeTaxRate { get; set; }
        public decimal AddOnProfit { get; set; }

        public decimal CostExcludingTax { get; set; }
        public decimal SellingValueExcludingTax { get; set; }

        /// <summary>One of <see cref="GdCostingDispositionNames"/>.</summary>
        public string Disposition { get; set; } = GdCostingDispositionNames.Skipped;

        /// <summary>The record of what the import decided and why — the main
        /// reason to look at this screen at all.</summary>
        public string? DispositionNote { get; set; }

        /// <summary>The item type this line resolved to (matched, or newly
        /// created/adopted), by NAME. Null when nothing was ever resolved
        /// (Skipped with no match, or Ambiguous).</summary>
        public string? ItemTypeName { get; set; }
    }

    /// <summary>One consignment with its lines — <c>GET /api/import-consignments/{id}</c>.</summary>
    public class ImportConsignmentDetailDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string GdNumber { get; set; } = "";
        public DateTime GdDate { get; set; }
        public decimal TotalCostExcludingTax { get; set; }
        public decimal TotalInputTax { get; set; }
        public decimal TotalIncomeTax { get; set; }
        public decimal TotalSellingValue { get; set; }
        public string Mode { get; set; } = GdCostingImportModeNames.Backfill;
        public string? Notes { get; set; }
        public DateTime ImportedAt { get; set; }
        public string? ImportedByUserName { get; set; }
        public bool HasJournalEntry { get; set; }
        public int? JournalEntryId { get; set; }
        public List<ImportConsignmentLineDetailDto> Lines { get; set; } = new();

        // ── Import Clearing subledger (Task 23) — see ImportConsignmentListItemDto ──
        public decimal ImportClearingCredited { get; set; }
        public decimal AmountSettled { get; set; }
        public decimal Outstanding => ImportClearingCredited - AmountSettled;
        public string SettlementStatus { get; set; } = ImportConsignmentSettlementStatusNames.NotPosted;

        /// <summary>Every non-cancelled payment settled against this
        /// consignment, newest first — "which GD unpaid" answered at the
        /// document level, not just the total.</summary>
        public List<ImportConsignmentSettlementDto> Settlements { get; set; } = new();
    }

    /// <summary>
    /// What a delete actually undid — echoed back so the operator sees exactly
    /// what happened, not just a bare 204. See
    /// <see cref="Services.Interfaces.IImportConsignmentService.DeleteAsync"/>.
    /// </summary>
    public class ImportConsignmentDeleteResultDto
    {
        public string GdNumber { get; set; } = "";

        /// <summary>Opening balances whose cost this delete reversed (a
        /// CostOnly match) — reset to 0 in Backfill mode, or had this
        /// consignment's own contribution subtracted back out in New Arrivals
        /// mode.</summary>
        public int BalancesCostReversed { get; set; }

        /// <summary>Opening balances this consignment created (StockPosted)
        /// that were removed along with it.</summary>
        public int BalancesDeleted { get; set; }

        public bool JournalEntryWithdrawn { get; set; }

        public List<string> Messages { get; set; } = new();
    }
}
