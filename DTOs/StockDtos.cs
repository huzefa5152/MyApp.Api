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

        /// <summary>
        /// What the OPENING quantity was worth, excluding sales tax -- the
        /// figure the operator entered (or the stock sheet imported) against
        /// the opening balance, not a re-derivation of it. Reported so the
        /// three quantity columns each have their money beside them.
        /// </summary>
        public decimal OpeningValueExcludingTax { get; set; }

        /// <summary>Value that came in, and went out, over the item's life.</summary>
        public decimal ValueIn { get; set; }
        public decimal ValueOut { get; set; }

        // ── Actual (landed) cost, alongside the selling value ────────────────
        // From the GD costing import's OpeningStockBalance.ActualCostExcludingTax,
        // walked by the SAME StockValuation pass as everything else on this row
        // — it DEPLETES as stock sells, exactly like ValueExcludingTax does,
        // never a static opening figure. Zero means not known (nothing imported
        // an actual cost for this item). NULL is a DIFFERENT thing: the caller
        // lacks stock.actualcost.view and StockController redacted these three
        // fields (plus StockMovementRowDto's own pair) before returning the row
        // — never confuse the two, which is exactly why zero was not reused for
        // "not permitted" (a redacted Margin would otherwise render as the
        // FULL selling value, reading like a 100% margin rather than a hidden
        // one).

        /// <summary>What the on-hand quantity actually cost, excluding tax.
        /// Null when the caller lacks <c>stock.actualcost.view</c>.</summary>
        public decimal? ActualCostExcludingTax { get; set; }

        /// <summary>
        /// What the OPENING quantity actually cost — the stored figure the GD
        /// costing import wrote, not a re-derivation, exactly as
        /// <see cref="OpeningValueExcludingTax"/> is for the selling pool.
        ///
        /// Reported so the cost of goods SOLD is answerable: nothing but the GD
        /// costing import puts an actual cost on an opening, and nothing but a
        /// hand adjustment puts one on a movement, so for an importer
        /// <c>opening − on-hand</c> IS what the goods that left actually cost.
        /// Zero means no costing has been imported for this item. Null means
        /// the caller lacks <c>stock.actualcost.view</c> — see above.
        /// </summary>
        public decimal? OpeningActualCostExcludingTax { get; set; }

        /// <summary>Weighted-average ACTUAL cost of a single unit on hand —
        /// the actual-cost pool's own <see cref="UnitCost"/>. Null when the
        /// caller lacks <c>stock.actualcost.view</c>.</summary>
        public decimal? ActualUnitCost { get; set; }

        /// <summary>Selling value less actual cost. Negative is a real state —
        /// stock whose selling value has fallen below what it cost — and must
        /// render as such, never clamped. Null (not a number) when
        /// <see cref="ActualCostExcludingTax"/> is null — a redacted cost must
        /// not produce a Margin that reads as "cost is zero".</summary>
        public decimal? Margin => ValueExcludingTax - ActualCostExcludingTax;

        /// <summary>
        /// Margin as a percentage of selling value, or NULL when there is no
        /// selling value to measure against, or when <see cref="Margin"/>
        /// itself is null (redacted) — the same rule
        /// <see cref="OpeningStockBalanceDto.MarginPercent"/> already applies,
        /// for the same reason: a row can carry a real actual cost with no
        /// selling value yet, and a MarginPercent of 0 would read as breakeven
        /// on a row that is entirely under water.
        /// </summary>
        public decimal? MarginPercent => Margin.HasValue && ValueExcludingTax > 0m
            ? Math.Round(Margin.Value * 100m / ValueExcludingTax, 2, MidpointRounding.AwayFromZero)
            : null;
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

        /// <summary>Actual (landed) cost of one unit, as this movement was
        /// valued by the actual-cost pool —
        /// <see cref="MyApp.Api.Helpers.StockValuation.Step"/>'s own figure,
        /// never recomputed. Null when the caller lacks
        /// <c>stock.actualcost.view</c> — see the note on
        /// <see cref="StockOnHandRowDto.ActualCostExcludingTax"/>.</summary>
        public decimal? ActualUnitCost { get; set; }

        /// <summary>Actual cost on hand immediately after this movement,
        /// excluding tax — the actual-cost pool's own running total. Null when
        /// the caller lacks <c>stock.actualcost.view</c>.</summary>
        public decimal? RunningActualValue { get; set; }
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

        /// <summary>What the opening quantity cost, excluding sales tax.
        /// Zero means not known.</summary>
        public decimal ActualCostExcludingTax { get; set; }

        /// <summary>Selling value less actual cost. Negative is a real state —
        /// stock whose selling value has fallen below what it cost — and must
        /// render as such, never clamped.</summary>
        public decimal Margin => ValueExcludingTax - ActualCostExcludingTax;

        /// <summary>
        /// Margin as a percentage of selling value, or NULL when there is no selling
        /// value to measure against.
        ///
        /// Null rather than zero on purpose. A row can carry a real actual cost with
        /// no selling value yet — a GD import sets the cost, and nobody has priced the
        /// item. Margin reports the full negative in that case, and a MarginPercent of
        /// 0 would contradict it, reading as breakeven on a row that is entirely
        /// under water. Null lets the caller render "—" instead of a number that is
        /// not true.
        /// </summary>
        public decimal? MarginPercent => ValueExcludingTax > 0m
            ? Math.Round(Margin * 100m / ValueExcludingTax, 2, MidpointRounding.AwayFromZero)
            : null;
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

        /// <summary>
        /// What the quantity cost, excluding sales tax.
        ///
        /// NULLABLE, and null means "the caller did not mention it" — the row
        /// keeps the cost it had. Only a supplied value sets it, and 0 clears
        /// it. Same distinction UpdateInvoiceDto.AdvanceTaxSection draws, for
        /// the same reason: the sheet importer, the UI and any API client all
        /// post here, and a caller editing only the quantity must not silently
        /// erase a cost that took an import to establish.
        ///
        /// ValueExcludingTax deliberately keeps its non-nullable overwrite
        /// behaviour — changing that would alter how every current caller
        /// behaves.
        /// </summary>
        public decimal? ActualCostExcludingTax { get; set; }

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

        /// <summary>
        /// In <c>set</c> mode: what that quantity actually COST, excluding
        /// sales tax — the actual-cost pool's own <see cref="TargetValueExcludingTax"/>.
        /// Null means the caller did not mention actual cost, so it is left
        /// exactly where it stands (mirrors that field's own null contract).
        /// </summary>
        public decimal? TargetActualCostExcludingTax { get; set; }
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

        /// <summary>
        /// What one unit actually COST on an adjustment UP, excluding sales
        /// tax — the actual-cost pool's own <see cref="UnitCostExcludingTax"/>,
        /// under the identical contract: null values the stock coming in at
        /// the actual-cost average already on hand, and it is ignored on an
        /// adjustment DOWN, since stock leaving is always costed at the
        /// running ACTUAL average, never a stated figure.
        /// </summary>
        public decimal? ActualUnitCostExcludingTax { get; set; }

        /// <summary>
        /// Signed ACTUAL-cost correction, applied WITHOUT moving any
        /// quantity, in <c>delta</c> mode — the actual-cost pool's own
        /// <see cref="ValueDelta"/>. This is what makes a wrong landed cost
        /// fixable on its own, the same way <see cref="ValueDelta"/> already
        /// makes a wrong selling value fixable without moving goods.
        /// </summary>
        public decimal? ActualValueDelta { get; set; }

        /// <summary>Rate as a percentage (18, 25). Only read alongside a
        /// stated unit cost.</summary>
        public decimal? SalesTaxRate { get; set; }
    }

    /// <summary>
    /// One item on the stock export — one ROW of the customs-lot stock sheet:
    /// the on-hand figures the dashboard shows, plus the customs declaration
    /// they arrived on where the item names exactly one.
    ///
    /// No movement history: the exported sheet is the client's own layout,
    /// which has one row per item and nowhere to nest a drill-down. Movement
    /// detail lives on the Stock Movements page.
    /// </summary>
    public class StockExportItemDto
    {
        public StockOnHandRowDto Summary { get; set; } = new();

        /// <summary>
        /// Customs declaration reference for this item, and its date — the
        /// stock sheet's "GDs No" and "GD Date".
        ///
        /// Filled ONLY when every <c>OpeningStockLot</c> behind the item names
        /// the SAME declaration. An item held across several GDs has no single
        /// answer, and the export is one row per item: naming the first one
        /// would attribute the whole position to a declaration that covers part
        /// of it. Blank is the honest answer, and it is what an item bought on
        /// purchase bills (no lots at all) reports too.
        /// </summary>
        public string? LotRef { get; set; }
        public DateTime? LotDate { get; set; }
    }

    /// <summary>Everything the stock workbook needs, resolved server-side.</summary>
    public class StockExportDto
    {
        public string CompanyName { get; set; } = "";
        public string Title { get; set; } = "Stock Valuation Report";
        public DateTime GeneratedAt { get; set; }

        /// <summary>Provenance line: what shaped this export (search, scope).</summary>
        public List<string> FiltersApplied { get; set; } = new();

        public List<StockExportItemDto> Items { get; set; } = new();
    }
}
