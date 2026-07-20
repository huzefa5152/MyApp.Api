namespace MyApp.Api.Models
{
    /// <summary>
    /// A single priced line on a <see cref="SalesQuote"/>. Quantity carries
    /// the same decimal(18,4) contract as <see cref="DeliveryItem"/> /
    /// <see cref="InvoiceItem"/> so fractional UOMs (KG, Litre) survive the
    /// round-trip; money columns are decimal(18,2).
    ///
    /// UnitPrice is required for every quote line (a quote without prices is
    /// meaningless). That price is remembered so the downstream Bill can reuse
    /// it: when a Sales Order is billed, the invoice-prefill resolves each
    /// line's unit price from the originating quote line first. The line's
    /// Description is also upserted into the generic <see cref="ItemDescription"/>
    /// catalog so it becomes a reusable suggestion on future documents.
    /// </summary>
    public class SalesQuoteItem
    {
        public int Id { get; set; }
        public int SalesQuoteId { get; set; }

        /// <summary>Optional link to the FBR-mapped product catalog entry.</summary>
        public int? ItemTypeId { get; set; }

        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";

        // Pricing — the whole point of a quote.
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }

        // Navigation
        public SalesQuote SalesQuote { get; set; } = null!;
        public ItemType? ItemType { get; set; }
    }
}
