namespace MyApp.Api.Models
{
    public class DeliveryItem
    {
        public int Id { get; set; }
        public int DeliveryChallanId { get; set; }
        public DeliveryChallan DeliveryChallan { get; set; }

        public int? ItemTypeId { get; set; }
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
    }
}
