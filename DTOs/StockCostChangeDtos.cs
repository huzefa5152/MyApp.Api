namespace MyApp.Api.DTOs
{
    /// <summary>One entry in an item's cost history. Deltas are DERIVED here
    /// rather than stored (CLAUDE.md 5b-4: never keep a second copy of a
    /// computable number) so a stored before/after pair can never disagree with
    /// the change it describes.</summary>
    public class StockCostChangeDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public string ItemTypeName { get; set; } = "";
        public string? HsCode { get; set; }
        public int? OpeningStockBalanceId { get; set; }

        public DateTime ChangedAt { get; set; }
        public int? ChangedByUserId { get; set; }
        public string? ChangedByUserName { get; set; }

        public string Source { get; set; } = "";
        public string? SourceRef { get; set; }
        public int? ImportRunId { get; set; }
        public int? ImportConsignmentId { get; set; }

        public decimal OldQuantity { get; set; }
        public decimal NewQuantity { get; set; }
        public decimal OldActualCostExcludingTax { get; set; }
        public decimal NewActualCostExcludingTax { get; set; }
        public decimal OldValueExcludingTax { get; set; }
        public decimal NewValueExcludingTax { get; set; }

        public decimal QuantityDelta => NewQuantity - OldQuantity;
        public decimal ActualCostDelta => NewActualCostExcludingTax - OldActualCostExcludingTax;
        public decimal ValueDelta => NewValueExcludingTax - OldValueExcludingTax;

        public string? Note { get; set; }
    }
}
