namespace MyApp.Api.Models
{
    /// <summary>
    /// One customer-document line a purchase row buys, and how much of it.
    /// Exactly one of the three line ids is set. A combined purchase row
    /// carries one source per line it covers, and their quantities add up to
    /// the row's. What is left to buy is counted per trail (sales order line →
    /// challan lines → sale bill lines) by <c>CustomerDemandService</c>.
    /// </summary>
    public class PurchaseItemSource
    {
        public int Id { get; set; }
        public int PurchaseItemId { get; set; }
        public int? SalesOrderItemId { get; set; }
        public int? DeliveryItemId { get; set; }
        public int? InvoiceItemId { get; set; }
        public decimal Quantity { get; set; }

        public PurchaseItem PurchaseItem { get; set; } = null!;
        public SalesOrderItem? SalesOrderItem { get; set; }
        public DeliveryItem? DeliveryItem { get; set; }
        public InvoiceItem? InvoiceItem { get; set; }
    }
}
