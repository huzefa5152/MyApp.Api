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
        /// Per-company on-hand qty (opening balance + Σ purchase In − Σ sale Out)
        /// — populated only when GET /api/itemtypes is called with
        /// ?companyId=X AND that company has inventory tracking enabled.
        /// Null otherwise.
        ///
        /// Frontend dropdowns sort by this descending so items the
        /// operator can actually sell surface to the top — types with
        /// no purchase history fall to the bottom. Source: shared
        /// IStockService.GetOnHandBulkAsync so the number matches
        /// exactly what the Stock Dashboard shows.
        /// 2026-05-12: added; promoted to decimal alongside
        /// StockMovement.Quantity precision bump.
        /// </summary>
        public decimal? AvailableQty { get; set; }

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
