namespace MyApp.Api.Models
{
    /// <summary>
    /// A single priced line on a <see cref="SalesQuote"/>. Quantity carries
    /// the same decimal(18,4) contract as <see cref="DeliveryItem"/> /
    /// <see cref="InvoiceItem"/> so fractional UOMs (KG, Litre) survive the
    /// round-trip; money columns are decimal(18,2).
    /// </summary>
    public class SalesQuoteItem
    {
        public int Id { get; set; }
        public int SalesQuoteId { get; set; }

        /// <summary>Optional link to the FBR-mapped product catalog entry.</summary>
        public int? ItemTypeId { get; set; }

        /// <summary>
        /// Optional link to a per-company <see cref="NonInventoryItem"/> (a GL
        /// account shortcut like "Freight Charges"). At most one of
        /// <see cref="ItemTypeId"/> or this is set. See <see cref="InvoiceItem"/>.
        /// </summary>
        public int? NonInventoryItemId { get; set; }

        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Pricing — the whole point of a quote.
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        // Navigation
        public SalesQuote SalesQuote { get; set; } = null!;
        public ItemType? ItemType { get; set; }
        public NonInventoryItem? NonInventoryItem { get; set; }
    }
}
