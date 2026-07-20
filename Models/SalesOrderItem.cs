namespace MyApp.Api.Models
{
    /// <summary>
    /// A single ordered line on a <see cref="SalesOrder"/>. Quantity-only
    /// (no price). The ordered quantity is the denominator for fulfilment:
    /// delivered quantity is the SUM of <see cref="DeliveryItem.Quantity"/>
    /// across every challan line that links back to this row
    /// (DeliveryItem.SalesOrderItemId == this.Id). Delivered/remaining are
    /// computed on read, never stored, so they can't drift.
    ///
    /// The line's Description is upserted into the generic
    /// <see cref="ItemDescription"/> catalog on save so it becomes a reusable
    /// suggestion on future documents.
    /// </summary>
    public class SalesOrderItem
    {
        public int Id { get; set; }
        public int SalesOrderId { get; set; }

        /// <summary>Optional link to the FBR-mapped product catalog entry.</summary>
        public int? ItemTypeId { get; set; }

        public string Description { get; set; } = "";
        /// <summary>Ordered quantity. Same decimal(18,4) contract as DeliveryItem.</summary>
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Navigation
        public SalesOrder SalesOrder { get; set; } = null!;
        public ItemType? ItemType { get; set; }
        /// <summary>Challan lines that fulfil this ordered line (qty rolls up).</summary>
        public ICollection<DeliveryItem> DeliveryItems { get; set; } = new List<DeliveryItem>();
    }
}
