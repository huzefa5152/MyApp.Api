namespace MyApp.Api.Models
{
    /// <summary>
    /// One customs GD (Goods Declaration) costing sheet, imported as a header
    /// plus its <see cref="ImportConsignmentLine"/> rows.
    ///
    /// This is the COST-side counterpart to <see cref="OpeningStockLot"/>: that
    /// table is the stock sheet's own detail behind a SELLING value, kept
    /// exactly as written; this is the costing sheet's detail behind what the
    /// same goods actually cost to land — assessed customs value plus duties.
    /// The two sheets describe the same consignments from opposite sides of the
    /// same transaction, which is exactly why they were verified against each
    /// other rather than merged: see
    /// <see cref="OpeningStockBalance.ActualCostExcludingTax"/> for how they
    /// reconcile and why one column cannot hold both figures.
    ///
    /// Importing this header + its lines writes nothing else by itself. Task 6
    /// (this entity) is persistence only; matching a line to an
    /// <see cref="OpeningStockBalance"/> and writing
    /// <see cref="OpeningStockBalance.ActualCostExcludingTax"/> is Task 10.
    /// Booking a line as brand-new stock
    /// (<see cref="GdCostingDisposition.StockPosted"/>) is not reachable until
    /// a later release.
    /// </summary>
    public class ImportConsignment
    {
        public int Id { get; set; }

        public int CompanyId { get; set; }

        /// <summary>
        /// The customs GD number, UNIQUE per company. Externally issued, so
        /// MyApp.Api.Helpers.NumberAllocationRetry deliberately does NOT apply:
        /// a collision here is a duplicate import and must be reported as one,
        /// not retried into a second number.
        /// </summary>
        public string GdNumber { get; set; } = "";

        /// <summary>Declaration date, as the costing sheet states it.</summary>
        public DateTime GdDate { get; set; }

        /// <summary>
        /// Sum of every line's <see cref="ImportConsignmentLine.CostExcludingTax"/>.
        /// A display total only — nothing downstream reads it back; the lines
        /// remain the source of truth, exactly as
        /// <see cref="OpeningStockBalance"/> treats its <see cref="OpeningStockLot"/>
        /// rows.
        /// </summary>
        public decimal TotalCostExcludingTax { get; set; }

        /// <summary>Sum of every line's input (recoverable) sales tax — sales
        /// tax plus additional sales tax paid at import.</summary>
        public decimal TotalInputTax { get; set; }

        /// <summary>Sum of every line's income tax collected at import.</summary>
        public decimal TotalIncomeTax { get; set; }

        /// <summary>
        /// Sum of every line's <see cref="ImportConsignmentLine.SellingValueExcludingTax"/>
        /// — the costing sheet's own arithmetic for what the consignment should
        /// sell for, kept for comparison against the stock sheet's independent
        /// figure. See <see cref="OpeningStockBalance.ActualCostExcludingTax"/>.
        /// </summary>
        public decimal TotalSellingValue { get; set; }

        /// <summary>
        /// The import run that wrote this header. Nullable so the consignment
        /// outlives a deleted run, exactly as
        /// <see cref="OpeningStockLot.ImportRunId"/> does. Deliberately NOT a
        /// foreign key, for the same reason that property isn't one either —
        /// see <see cref="ImportConsignmentLine.ImportRunId"/>.
        /// </summary>
        public int? ImportRunId { get; set; }

        /// <summary>
        /// One of <c>DTOs.GdCostingImportModeNames</c> ("backfill" /
        /// "new-arrivals"), resolved at commit time and stored here — the same
        /// "resolve once, keep it" reasoning as every rate on
        /// <see cref="ImportConsignmentLine"/>. Task 21 needs this to know HOW
        /// to undo a <see cref="GdCostingDisposition.CostOnly"/> line's effect
        /// on the balance it costed: Backfill SET the cost (no prior value is
        /// stored anywhere, so reversal is to 0), New Arrivals ADDED quantity,
        /// cost and selling value (so reversal subtracts exactly that). Without
        /// this column a delete could not tell the two apart after the fact.
        ///
        /// Defaults to "backfill" for every row written before this column
        /// existed — correct for all of them, not a guess: New Arrivals never
        /// existed as an option before Task 19, and the migration that added
        /// this column flips to "new-arrivals" any pre-existing row that
        /// provably posted an ImportConsignment journal entry (Task 20), which
        /// only New Arrivals mode ever does.
        /// </summary>
        public string Mode { get; set; } = "backfill";

        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // ── Import Clearing subledger (Task 23) ─────────────────────────────

        /// <summary>
        /// What THIS consignment actually credited to Import Clearing when it
        /// posted — written once, by <see cref="Services.Implementations.PostingService.PostImportConsignmentAsync"/>,
        /// at commit time. 0 for a Backfill consignment (never posts) and for
        /// any consignment committed while the company's GL was off — both
        /// genuinely owe nothing through this route, so 0 is the correct
        /// answer, not a placeholder.
        ///
        /// Deliberately NOT re-derived from <see cref="TotalCostExcludingTax"/> /
        /// <see cref="TotalInputTax"/> / <see cref="TotalIncomeTax"/>: those are
        /// CLIENT-submitted headline totals (see their own doc comments), while
        /// the posted figure is server truth recomputed per line and — under
        /// New Arrivals — includes a CostOnly line's contribution that a naive
        /// re-derivation could easily double-count or drop. Only the posting
        /// itself knows the true credited amount.
        /// </summary>
        public decimal ImportClearingCredited { get; set; }

        /// <summary>
        /// Σ of every NON-cancelled <see cref="Accounting.PaymentAllocation.Amount"/>
        /// whose <see cref="Accounting.PaymentAllocation.ImportConsignmentId"/>
        /// points here — recomputed by <see cref="Services.Implementations.PaymentService"/>
        /// inside the same transaction that writes a settling payment, exactly as
        /// <c>PurchaseBill.AmountPaid</c> is maintained. Outstanding is always
        /// <see cref="ImportClearingCredited"/> minus this — never separately
        /// stored, so it can never drift from the two figures it is made of.
        /// </summary>
        public decimal AmountSettled { get; set; }

        // Navigation
        public Company Company { get; set; } = null!;

        /// <summary>
        /// This consignment's lines. Cascades with it: a consignment deleted
        /// (or re-imported, once that exists) takes its own lines and nothing
        /// else, the same "rewritten wholesale with its parent" contract
        /// <see cref="OpeningStockLot"/> follows.
        /// </summary>
        public ICollection<ImportConsignmentLine> Lines { get; set; } = new List<ImportConsignmentLine>();
    }
}
