namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="DeliveryItem"/> — one line on a goods receipt.
    /// The Quantity here is what physically arrived; if it differs from the
    /// PurchaseBill's quantity (short shipment, breakage), the operator
    /// records the discrepancy by editing this line and the bill stays
    /// untouched.
    /// </summary>
    public class GoodsReceiptItem
    {
        public int Id { get; set; }
        public int GoodsReceiptId { get; set; }
        public GoodsReceipt GoodsReceipt { get; set; } = null!;

        public int? ItemTypeId { get; set; }
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Navigation
        public ItemType? ItemType { get; set; }
    }
}
