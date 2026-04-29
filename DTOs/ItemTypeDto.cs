namespace MyApp.Api.DTOs
{
    public class ItemTypeDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";

        // FBR Digital Invoicing metadata. A bill's line items inherit these
        // values from the ItemType they reference — so users don't need to
        // enter HS Code / Sale Type / UOM on every single bill.
        public string? HSCode { get; set; }
        public string? UOM { get; set; }
        public int? FbrUOMId { get; set; }
        public string? SaleType { get; set; }
        public string? FbrDescription { get; set; }

        public bool IsFavorite { get; set; }
        public int UsageCount { get; set; }

        /// <summary>
        /// Set on UPDATE responses only — tells the UI how many bill /
        /// challan lines got auto-synced because this catalog row changed.
        /// Lets us notify the operator: "47 unposted lines updated; 3
        /// FBR-submitted lines left alone."
        /// </summary>
        public ItemTypePropagationSummaryDto? Propagation { get; set; }
    }

    public class ItemTypePropagationSummaryDto
    {
        public int InvoiceItemsUpdated { get; set; }
        public int DeliveryItemsUpdated { get; set; }
        public int SubmittedInvoiceLinesSkipped { get; set; }
    }
}
