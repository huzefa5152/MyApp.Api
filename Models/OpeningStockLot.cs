namespace MyApp.Api.Models
{
    /// <summary>
    /// One row of the customs-lot stock sheet, kept as it was written.
    ///
    /// <see cref="OpeningStockBalance"/> holds ONE figure per (Company,
    /// ItemType) — it has to, because re-importing a corrected sheet SETS that
    /// figure and anything else would double it. But the sheet those figures
    /// come from is finer grained: an item is held across several customs
    /// declarations, each with its own GD number, arrival date, landed unit
    /// cost, and its own opening / consumed / balance triple. Grouping on the
    /// HS code adds those up, which is right for the stock position and loses
    /// everything an accountant reconciles against.
    ///
    /// So the detail is kept alongside rather than instead. Nothing derives
    /// stock quantity, value or tax from this table — <c>StockValuation</c> and
    /// the opening balance are untouched — it is the audit trail that says
    /// which declarations, at which costs, add up to the balance on the
    /// dashboard.
    ///
    /// Rewritten wholesale whenever the balance it belongs to is rewritten: a
    /// re-import replaces the lots as well as the total, so the two can never
    /// describe different sheets.
    /// </summary>
    public class OpeningStockLot
    {
        public int Id { get; set; }

        /// <summary>The merged position this lot fed. Cascade-deleted with it.</summary>
        public int OpeningStockBalanceId { get; set; }

        /// <summary>Row number in the source sheet, so a figure can be traced
        /// back to the cell it came from.</summary>
        public int SourceRow { get; set; }

        /// <summary>
        /// The product name as the sheet wrote it. Several names share one
        /// tariff code — four different machines under 8543.7090 — and the
        /// merged balance can only carry the first. This is where the other
        /// three survive.
        /// </summary>
        public string ItemNameOnSheet { get; set; } = "";

        /// <summary>Code as imported (already cleaned of the sheet's decoration).</summary>
        public string? HsCode { get; set; }

        /// <summary>Customs declaration reference — the sheet's GD number.</summary>
        public string? LotRef { get; set; }

        /// <summary>Declaration date, when the sheet states one.</summary>
        public DateTime? LotDate { get; set; }

        /// <summary>Unit as written on the row, which can differ between lots of
        /// the same item (Kg on one declaration, Kgs on another).</summary>
        public string? Unit { get; set; }

        /// <summary>Landed unit cost as STATED, not derived. decimal(18,6) —
        /// these sheets carry a computed price with many decimals and rounding
        /// it to 2 would not reproduce the row's own value.</summary>
        public decimal? UnitPrice { get; set; }

        /// <summary>Opening block: what arrived.</summary>
        public decimal? OpeningQuantity { get; set; }
        public decimal? OpeningValueExcludingTax { get; set; }

        /// <summary>Rate as a PERCENTAGE (18.00), matching
        /// <see cref="OpeningStockBalance.SalesTaxRate"/>.</summary>
        public decimal? OpeningSalesTaxRate { get; set; }

        /// <summary>Consumed block: what has gone out of the lot.</summary>
        public decimal? ConsumedQuantity { get; set; }
        public decimal? ConsumedValueExcludingTax { get; set; }
        public decimal? ConsumedSalesTaxRate { get; set; }

        /// <summary>Balance block: what is left. This is the only triple the
        /// import itself uses — the others are history.</summary>
        public decimal BalanceQuantity { get; set; }
        public decimal BalanceValueExcludingTax { get; set; }
        public decimal BalanceSalesTaxRate { get; set; }

        /// <summary>The import that wrote this row. Nullable so the lot outlives
        /// a deleted run, exactly as <c>ImportRun.ImportProfileId</c> does.</summary>
        public int? ImportRunId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public OpeningStockBalance OpeningStockBalance { get; set; } = null!;
    }
}
