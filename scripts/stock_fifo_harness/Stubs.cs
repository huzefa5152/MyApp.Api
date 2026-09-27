namespace MyApp.Api.Models
{
    // Shape-for-shape copy of the fields StockValuation reads from the real
    // entity (Models/StockMovement.cs). Enum values must match it.
    public enum StockMovementSourceType
    {
        OpeningBalance = 0, PurchaseBill = 1, Invoice = 2, Adjustment = 3,
        GoodsReceipt = 4, PurchaseDebitNote = 5, Revaluation = 6,
    }
    public enum StockMovementDirection { In = 1, Out = 2 }
    public class StockMovement
    {
        public int Id { get; set; }
        public StockMovementDirection Direction { get; set; }
        public decimal Quantity { get; set; }
        public decimal? UnitCostExcludingTax { get; set; }
        public decimal? SalesTaxRate { get; set; }
        public decimal? ValueAdjustmentExcludingTax { get; set; }
        public decimal? ActualUnitCostExcludingTax { get; set; }
        public decimal? ActualValueAdjustmentExcludingTax { get; set; }
        public StockMovementSourceType SourceType { get; set; }
        public int? SourceId { get; set; }
        public DateTime MovementDate { get; set; }
    }
}
