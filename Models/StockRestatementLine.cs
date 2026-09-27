namespace MyApp.Api.Models
{
    /// <summary>
    /// One GD line an item is RESTATED to under FIFO by GD (CLAUDE.md 5b-17).
    ///
    /// A restatement says "on this date the item holds exactly these GD lines":
    /// the client's stock sheet is the truth, and the FIFO walk drops whatever
    /// pools it had and continues from these. It exists because a stock sheet
    /// can be reconciled to a WEIGHTED-AVERAGE figure with ordinary adjustments,
    /// but adjustments cannot say which GD the stock is on -- stock put back by
    /// an adjustment is "other stock" to FIFO, and a sale of it can never be
    /// traced to a declaration.
    ///
    /// The lines hang off one value-only <see cref="StockMovement"/>
    /// (<see cref="StockMovementSourceType.Revaluation"/>, quantity 0) per item,
    /// which dates the restatement and carries, for the weighted average, the
    /// value change that lands it on the same total. Quantity never moves: the
    /// lines must add up to what is on hand, and the endpoint refuses otherwise.
    /// Deleting the movement (or the company) removes its lines by cascade.
    /// </summary>
    public class StockRestatementLine
    {
        public int Id { get; set; }

        /// <summary>Scoping only -- no FK, the movement already carries the
        /// company (a second cascade path to one table is refused by SQL Server).</summary>
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }

        public int StockMovementId { get; set; }
        public StockMovement StockMovement { get; set; } = null!;

        public string GdNumber { get; set; } = "";
        public DateTime? GdDate { get; set; }
        /// <summary>First of the month the line's input tax was claimed in; null
        /// = not claimed yet.</summary>
        public DateTime? ClaimMonth { get; set; }

        /// <summary>The sheet row it came from, for the audit trail and as the
        /// tiebreak between lines of one GD.</summary>
        public int SourceRow { get; set; }
        public string? Description { get; set; }

        public decimal Quantity { get; set; }
        public decimal ValueExcludingTax { get; set; }
        /// <summary>Landed cost carried by the line: the item's landed value at
        /// the restatement, spread over its lines by value.</summary>
        public decimal ActualValueExcludingTax { get; set; }
        public decimal SalesTaxRate { get; set; }

        /// <summary>The workbook the restatement came from.</summary>
        public string? SourceFile { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}
