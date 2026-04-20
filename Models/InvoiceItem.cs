namespace MyApp.Api.Models
{
    public class InvoiceItem
    {
        public int Id { get; set; }
        public int InvoiceId { get; set; }
        public int? DeliveryItemId { get; set; }

        /// <summary>
        /// Direct link to the ItemType (FBR-mapped product). Changing this on a
        /// bill overrides whatever type was set on the source delivery item, and
        /// auto-applies the ItemType's HS Code / UOM / Sale Type to this line.
        /// This lets users correct FBR classification at bill time without
        /// having to re-open the challan.
        /// </summary>
        public int? ItemTypeId { get; set; }

        public string ItemTypeName { get; set; } = "";
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        // FBR Digital Invoicing
        public string? HSCode { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public int? RateId { get; set; }

        /// <summary>
        /// Printed MRP × quantity for 3rd Schedule goods (SN008 / SN027).
        /// When SaleType = "3rd Schedule Goods", FBR requires this to be > 0 and
        /// the sales tax must be backed OUT of this retail price using the
        /// formula: salesTax = retailPrice × rate ÷ (1 + rate).
        /// Null for non-3rd-schedule items (FBR accepts 0.00 there).
        /// </summary>
        public decimal? FixedNotifiedValueOrRetailPrice { get; set; }

        // Navigation
        public Invoice Invoice { get; set; } = null!;
        public DeliveryItem? DeliveryItem { get; set; }
        public ItemType? ItemType { get; set; }
    }
}
