namespace MyApp.Api.Models
{
    /// <summary>
    /// Source/origin of a stock movement. Tells us which document caused
    /// the change so we can reverse it if the document is deleted, and so
    /// the operator can drill from the stock dashboard back to the bill /
    /// receipt that moved the inventory.
    /// </summary>
    public enum StockMovementSourceType
    {
        OpeningBalance = 0,
        PurchaseBill   = 1,
        Invoice        = 2,
        Adjustment     = 3,
        GoodsReceipt   = 4,
    }

    public enum StockMovementDirection
    {
        In  = 1,
        Out = 2,
    }

    /// <summary>
    /// One immutable inventory event. The on-hand for an item at any moment
    /// is computed as: OpeningBalance + Σ In − Σ Out, scoped by Company and
    /// ItemType. We never UPDATE these rows — if the source document is
    /// edited we INSERT compensating rows so the audit trail stays intact.
    ///
    /// Inventory is opt-in per company via Company.InventoryTrackingEnabled.
    /// While the flag is off, no rows are written here.
    /// </summary>
    public class StockMovement
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }

        public StockMovementDirection Direction { get; set; }

        /// <summary>
        /// Always positive. Signed math is done at query time using
        /// Direction (+ for In, − for Out).
        /// </summary>
        public int Quantity { get; set; }

        public StockMovementSourceType SourceType { get; set; }

        /// <summary>
        /// Id of the document that triggered this movement. PurchaseBillId
        /// for purchases, InvoiceId for sales, GoodsReceiptId for
        /// receipts, OpeningStockBalanceId for opening, null for free
        /// adjustments.
        /// </summary>
        public int? SourceId { get; set; }

        /// <summary>
        /// Document date — used so on-hand-as-of-date queries make sense
        /// (e.g. opening stock for a financial year).
        /// </summary>
        public DateTime MovementDate { get; set; }

        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ItemType ItemType { get; set; } = null!;
    }
}
