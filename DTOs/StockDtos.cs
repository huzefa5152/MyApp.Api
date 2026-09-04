namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One row on the Stock Dashboard: an item from the catalog with its
    /// current on-hand for the selected company and the most recent
    /// movement date. Drives the at-a-glance "what do we have?" view.
    /// </summary>
    public class StockOnHandRowDto
    {
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string? HSCode { get; set; }
        public string? UOM { get; set; }
        // 2026-05-12: promoted to decimal alongside StockMovement.Quantity
        // and OpeningStockBalance.Quantity so fractional UOMs (KG, Liter,
        // Carat) display without truncation.
        public decimal OnHand { get; set; }
        public decimal OpeningBalance { get; set; }
        public decimal TotalIn { get; set; }
        public decimal TotalOut { get; set; }
        public DateTime? LastMovementAt { get; set; }

        // ── Value, alongside the quantity ────────────────────────────────
        // The five figures the client's stock sheet is built from. Tax and the
        // inclusive total are DERIVED from the value and the rate, never stored
        // twice — the source sheet satisfies that identity on every row.

        /// <summary>What the stock on hand is worth, excluding sales tax.</summary>
        public decimal ValueExcludingTax { get; set; }

        /// <summary>Rate applying to this item, as a percentage (18, 25).</summary>
        public decimal SalesTaxRate { get; set; }

        /// <summary>ValueExcludingTax × SalesTaxRate / 100.</summary>
        public decimal SalesTax { get; set; }

        /// <summary>ValueExcludingTax + SalesTax.</summary>
        public decimal ValueIncludingTax { get; set; }

        /// <summary>Weighted-average cost of a single unit on hand.</summary>
        public decimal UnitCost { get; set; }

        /// <summary>Value that came in, and went out, over the item's life.</summary>
        public decimal ValueIn { get; set; }
        public decimal ValueOut { get; set; }
    }

    /// <summary>
    /// One row on the Stock Movements page — a flat audit feed of every
    /// change to inventory. Filterable by item, source type, date range.
    /// </summary>
    public class StockMovementRowDto
    {
        public int Id { get; set; }
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string Direction { get; set; } = ""; // "In" / "Out"
        public decimal Quantity { get; set; }
        public string SourceType { get; set; } = ""; // PurchaseBill, Invoice, OpeningBalance, ...
        public int? SourceId { get; set; }
        // Human-facing document number for the source (InvoiceNumber /
        // PurchaseBillNumber / GoodsReceiptNumber). SourceId is the internal
        // row id and must NOT be shown to operators — resolve to this. Null
        // for sources without a number (Adjustment / OpeningBalance) or when
        // the source row was since deleted.
        public string? SourceDocNumber { get; set; }
        public DateTime MovementDate { get; set; }
        public string? Notes { get; set; }

        // ── Money, worked out by walking the item's whole history ─────────
        // A movement's cost is the weighted average standing when it happened,
        // so these cannot be read off the row — they come from
        // StockValuation's trace over every movement for that item.

        /// <summary>Cost of one unit, as this movement was valued.</summary>
        public decimal UnitCost { get; set; }

        /// <summary>Quantity × UnitCost — what the movement added to, or took
        /// out of, the stock's value.</summary>
        public decimal Value { get; set; }

        /// <summary>Quantity on hand immediately AFTER this movement.</summary>
        public decimal RunningQuantity { get; set; }

        /// <summary>Value on hand immediately after, excluding sales tax.</summary>
        public decimal RunningValue { get; set; }
    }

    public class OpeningStockBalanceDto
    {
        public int? Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public decimal Quantity { get; set; }

        /// <summary>Value of that quantity excluding sales tax.</summary>
        public decimal ValueExcludingTax { get; set; }

        /// <summary>Rate as a percentage (18, 25) — matches Invoice.GSTRate.</summary>
        public decimal SalesTaxRate { get; set; }

        /// <summary>Derived, never stored: value × rate / 100.</summary>
        public decimal SalesTax => Math.Round(ValueExcludingTax * SalesTaxRate / 100m, 2, MidpointRounding.AwayFromZero);

        /// <summary>Derived: value + tax.</summary>
        public decimal ValueIncludingTax => ValueExcludingTax + SalesTax;
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    public class UpsertOpeningBalanceDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public decimal Quantity { get; set; }

        /// <summary>Value of that quantity excluding sales tax. Optional —
        /// 0 keeps the pre-valuation behaviour of a quantity-only opening.</summary>
        public decimal ValueExcludingTax { get; set; }

        /// <summary>Rate as a percentage (18, 25).</summary>
        public decimal SalesTaxRate { get; set; }

        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
    }

    /// <summary>How an adjustment states itself.</summary>
    public static class StockAdjustmentModes
    {
        /// <summary>The operator gives the CHANGE: "+10", "-3".</summary>
        public const string Delta = "delta";

        /// <summary>
        /// The operator gives the TRUTH: "it is actually 109 units worth
        /// 80,000". The server works out the change from where the item
        /// currently stands. This is the default, because someone fixing a
        /// mistake knows the right answer, not the size of their error.
        /// </summary>
        public const string Set = "set";
    }

    /// <summary>
    /// What one item's stock is worth, so a bill line can be priced from it.
    ///
    /// The unit price is the stock's WEIGHTED-AVERAGE cost — the same figure
    /// the stock dashboard shows and the same walk that values every movement
    /// (Helpers/StockValuation). Nothing here is a second valuation.
    /// </summary>
    public class StockLinePricingDto
    {
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string? Uom { get; set; }

        /// <summary>Quantity on hand.</summary>
        public decimal AvailableQuantity { get; set; }

        /// <summary>What that quantity is worth, excluding sales tax.</summary>
        public decimal AvailableValueExcludingTax { get; set; }

        /// <summary>
        /// Value / quantity — the price a line is derived at. Zero when there
        /// is no stock or no value to divide, in which case
        /// <see cref="CanPrice"/> is false and the operator types the figures
        /// themselves.
        /// </summary>
        public decimal UnitCost { get; set; }

        /// <summary>Rate on the stock, as a percentage.</summary>
        public decimal SalesTaxRate { get; set; }

        /// <summary>
        /// False when a unit price cannot be worked out: nothing on hand, or
        /// stock carrying no value. Saying so beats returning a zero the form
        /// would divide by.
        /// </summary>
        public bool CanPrice { get; set; }

        /// <summary>Why pricing is unavailable, for the form to show.</summary>
        public string? Note { get; set; }
    }

    public class CreateStockAdjustmentDto
    {
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }

        /// <summary>One of <see cref="StockAdjustmentModes"/>. Defaults to
        /// <c>delta</c> so existing callers are unaffected.</summary>
        public string? Mode { get; set; }

        /// <summary>Signed quantity — positive = adjust up, negative = down.
        /// Used in <c>delta</c> mode.</summary>
        public decimal Delta { get; set; }

        /// <summary>
        /// Signed money correction, applied WITHOUT moving any quantity, in
        /// <c>delta</c> mode. This is what makes a wrong value fixable at all:
        /// before it, value could only change when quantity changed, so an
        /// operator who had counted right and valued wrong had nowhere to go.
        /// </summary>
        public decimal? ValueDelta { get; set; }

        /// <summary>In <c>set</c> mode: what the on-hand quantity really is.</summary>
        public decimal? TargetQuantity { get; set; }

        /// <summary>In <c>set</c> mode: what that quantity is really worth,
        /// excluding sales tax.</summary>
        public decimal? TargetValueExcludingTax { get; set; }
        public DateTime MovementDate { get; set; }
        public string? Notes { get; set; }

        /// <summary>
        /// What one unit is worth on an adjustment UP, excluding sales tax.
        /// Optional: left null, the stock coming in is valued at the average
        /// already on hand, which is right for a count correction and wrong
        /// only when the operator knows the goods cost something else.
        /// Ignored on an adjustment DOWN — stock leaving is always costed at
        /// the running average.
        /// </summary>
        public decimal? UnitCostExcludingTax { get; set; }

        /// <summary>Rate as a percentage (18, 25). Only read alongside a
        /// stated unit cost.</summary>
        public decimal? SalesTaxRate { get; set; }
    }

    /// <summary>
    /// One item on the stock export: the same on-hand figures the dashboard
    /// shows, plus the movements behind them. The movements ride WITH the item
    /// rather than in a flat list so the workbook can nest them under the row
    /// they explain — the exported shape has to match the screen's drill-down.
    /// </summary>
    public class StockExportItemDto
    {
        public StockOnHandRowDto Summary { get; set; } = new();

        /// <summary>Oldest first — a drill-down reads like a bank statement.
        /// Empty when the caller may not see movements, or the item has none.</summary>
        public List<StockMovementRowDto> Movements { get; set; } = new();
    }

    /// <summary>Everything the stock workbook needs, resolved server-side.</summary>
    public class StockExportDto
    {
        public string CompanyName { get; set; } = "";
        public string Title { get; set; } = "Stock Valuation Report";
        public DateTime GeneratedAt { get; set; }

        /// <summary>Provenance line: what shaped this export (search, scope).</summary>
        public List<string> FiltersApplied { get; set; } = new();

        /// <summary>False when the caller lacks stock.movements.view — the
        /// workbook then says so rather than silently shipping bare rows.</summary>
        public bool IncludeMovements { get; set; }

        public List<StockExportItemDto> Items { get; set; } = new();
    }
}
