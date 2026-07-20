namespace MyApp.Api.Models
{
    public class DeliveryItem
    {
        public int Id { get; set; }
        public int DeliveryChallanId { get; set; }
        public DeliveryChallan DeliveryChallan { get; set; }

        public int? ItemTypeId { get; set; }

        // Optional link to the ordered line this challan line fulfils, when the
        // challan was raised against a Sales Order. Null for ad-hoc challans.
        // The ordered line's delivered quantity is the SUM of Quantity across
        // every DeliveryItem that points back to it.
        public int? SalesOrderItemId { get; set; }

        public string Description { get; set; } = "";
        /// <summary>
        /// Stored as decimal(18,4) so fractional UOMs (KG, Liter, Carat, etc.)
        /// can carry up to 4 decimal places. Integer-only UOMs (Pcs, SET,
        /// Pair, etc.) are still constrained at the form layer and validated
        /// server-side via the unit's AllowsDecimalQuantity flag.
        /// </summary>
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Navigation
        public ItemType? ItemType { get; set; }
        public SalesOrderItem? SalesOrderItem { get; set; }
    }
}
