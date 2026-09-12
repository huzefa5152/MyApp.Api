namespace MyApp.Api.Models
{
    /// <summary>
    /// What happened to one costing line, in the single vocabulary every
    /// release of this feature shares — declared in full now so a line
    /// written under a later release never needs a schema change to describe
    /// itself.
    ///
    /// Only <see cref="CostOnly"/> is reachable today. Task 6 is entities
    /// only — nothing writes yet; matching a line to an
    /// <see cref="OpeningStockBalance"/> and writing its
    /// <see cref="OpeningStockBalance.ActualCostExcludingTax"/> is Task 10.
    /// </summary>
    public enum GdCostingDisposition
    {
        /// <summary>Matched existing stock; only the actual cost was written.</summary>
        CostOnly = 0,

        /// <summary>Booked as new stock. Not reachable until a later release.</summary>
        StockPosted = 1,

        /// <summary>Read and recorded, but nothing was written. Carries a
        /// reason in <see cref="ImportConsignmentLine.DispositionNote"/>.</summary>
        Skipped = 2,

        /// <summary>Matched more than one balance, so no guess was made.</summary>
        Ambiguous = 3,
    }

    /// <summary>
    /// One row of a GD costing sheet — a single commodity's assessed customs
    /// value, duties, and the tax chain <c>Helpers.ImportCostingCalculator</c>
    /// resolves from them, kept as it was read and computed.
    ///
    /// Amounts and rates are STORED rather than left to be recomputed later,
    /// for two reasons that both matter: the sheet's own figures can carry an
    /// override the calculator would not reproduce, and a later GL entry must
    /// reconcile against exactly what was posted — not against a rate that may
    /// have since changed. This is the same reasoning
    /// <see cref="OpeningStockLot"/> already applies to the stock sheet, and
    /// that advance/further/withholding tax already apply to an invoice
    /// (CLAUDE.md 5b-5, 5b-10): resolve once at import time, store the result,
    /// let the published rate move on without moving history under it.
    /// </summary>
    public class ImportConsignmentLine
    {
        public int Id { get; set; }

        /// <summary>The consignment this line belongs to. Cascades with it.</summary>
        public int ImportConsignmentId { get; set; }

        /// <summary>Row number in the source sheet, so a figure can be traced
        /// back to the cell it came from — mirrors
        /// <see cref="OpeningStockLot.SourceRow"/>.</summary>
        public int SourceRow { get; set; }

        /// <summary>The commodity name as the COSTING sheet wrote it. Not
        /// necessarily identical to the stock sheet's own name for the same
        /// goods — <see cref="OpeningStockLot.ItemNameOnSheet"/> already can't
        /// be trusted to agree with itself across lots, and this is a
        /// different workbook again.</summary>
        public string DescriptionOnSheet { get; set; } = "";

        /// <summary>Code as the costing sheet wrote it, cleaned of decoration.
        /// Nullable: not every costing sheet carries one.</summary>
        public string? HsCode { get; set; }

        public decimal Quantity { get; set; }
        public string? Unit { get; set; }

        // Cost inputs, exactly as the sheet stated them —
        // Cost = AssessedValue + CustomsDuty + Acd + RegulatoryDuty.

        /// <summary>Customs' own assessed value, not the commercial invoice
        /// price.</summary>
        public decimal AssessedValue { get; set; }
        public decimal CustomsDuty { get; set; }

        /// <summary>Additional Customs Duty.</summary>
        public decimal Acd { get; set; }
        public decimal RegulatoryDuty { get; set; }

        /// <summary>Everything else the sheet folds into landed cost with no
        /// column of its own (clearing charges and the like). Added into the
        /// tax-bearing subtotal, not into <see cref="CostExcludingTax"/> —
        /// see <c>Helpers.ImportCostingCalculator</c>.</summary>
        public decimal Others { get; set; }

        // Rates RESOLVED at import time and stored, so the line keeps the
        // rate it was costed at when the published rates change (CLAUDE.md
        // 5b-5, 5b-10). Percentages (18.00), never fractions.
        public decimal SalesTaxRate { get; set; }

        /// <summary>Additional Sales Tax rate, s.3(1B).</summary>
        public decimal AstRate { get; set; }

        /// <summary>Advance income tax rate collected at import.</summary>
        public decimal IncomeTaxRate { get; set; }

        /// <summary>
        /// The tax-driven uplift added on top of the input-tax figure to reach
        /// <see cref="SellingValueExcludingTax"/>. Despite sitting beside the
        /// three rates above, this is a flat PKR AMOUNT, not a percentage —
        /// <c>Helpers.ImportCostingCalculator</c> adds it directly onto a money
        /// term (<c>Selling = InputTax / SalesTaxRate + AddOnProfit</c>), and
        /// the reader fills it from the sheet's own stated amount, not a rate
        /// cell. Stored at money precision for that reason.
        /// </summary>
        public decimal AddOnProfit { get; set; }

        // Resolved outcomes. Stored rather than derived on read because a line
        // may carry the sheet's own override, and because a later GL entry
        // must reproduce exactly what was posted.

        /// <summary>What this lot actually cost, excluding all three taxes —
        /// see <see cref="OpeningStockBalance.ActualCostExcludingTax"/>, the
        /// figure this line ultimately feeds.</summary>
        public decimal CostExcludingTax { get; set; }

        /// <summary>What the costing sheet's own arithmetic says this lot
        /// should sell for. Compared against the stock sheet's
        /// <see cref="OpeningStockBalance.ValueExcludingTax"/> when matching a
        /// line to a balance; never written into it — the two are allowed to
        /// disagree, and this column is where the costing sheet's side of that
        /// comparison is kept.</summary>
        public decimal SellingValueExcludingTax { get; set; }

        public GdCostingDisposition Disposition { get; set; }

        /// <summary>Why, when <see cref="Disposition"/> is
        /// <see cref="GdCostingDisposition.Skipped"/> or
        /// <see cref="GdCostingDisposition.Ambiguous"/>. Null on a clean
        /// match.</summary>
        public string? DispositionNote { get; set; }

        /// <summary>
        /// The catalog item this line was matched to, if any. A plain column
        /// with NO foreign key: <see cref="ItemType"/> is a global,
        /// company-less catalog (CLAUDE.md 5b-2), and this line does not need
        /// SQL Server to enforce the link — the same choice already made for
        /// <see cref="StockMovementId"/> and <see cref="ImportRunId"/> below.
        /// </summary>
        public int? ItemTypeId { get; set; }

        /// <summary>
        /// The opening balance this line's cost was written onto, once Task 10
        /// does the writing. Restrict, not cascade — see the configuration in
        /// <c>AppDbContext.OnModelCreating</c>: the balance already restricts
        /// on Company, and a second cascade path into the same table is what
        /// SQL Server refuses outright.
        /// </summary>
        public int? OpeningStockBalanceId { get; set; }

        /// <summary>
        /// Set only if a later release books this line as new stock
        /// (<see cref="GdCostingDisposition.StockPosted"/>). Deliberately NOT
        /// a foreign key — the same choice <c>Invoice.CopiedFromId</c> and
        /// <see cref="OpeningStockLot.ImportRunId"/> already make: a third
        /// cascade path into StockMovements is exactly what SQL Server
        /// refuses, and nothing here needs referential enforcement on it.
        /// </summary>
        public int? StockMovementId { get; set; }

        /// <summary>
        /// The import run that wrote this row. Nullable so the line outlives a
        /// deleted run, exactly as <see cref="OpeningStockLot.ImportRunId"/>
        /// does — and deliberately not a foreign key, for the same reason.
        /// </summary>
        public int? ImportRunId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public ImportConsignment ImportConsignment { get; set; } = null!;

        /// <summary>Set only once this line has been matched — nullable
        /// because most lines start life unmatched.</summary>
        public OpeningStockBalance? OpeningStockBalance { get; set; }
    }
}
