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

        // ── Per-company overlay (CompanyItemTypeSetting), 2026-07-14 ──
        // Populated on reads when GET /api/itemtypes?companyId=X is called, and
        // consumed on POST/PUT (?companyId=X) to upsert the company's overlay row.
        // All null when no company context (the global catalog view) or when the
        // company has no overlay row for this item yet.

        /// <summary>Optional division this item type belongs to WITHIN the selected
        /// company. Null = company-wide (available to every division). Lets a
        /// company and a division each curate their own inventory types.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        /// <summary>Company-specific income account SALES lines of this item type
        /// post to (Manager's "Custom income account"). Null = the company default
        /// inventory-sales account.</summary>
        public int? SaleAccountId { get; set; }
        public string? SaleAccountName { get; set; }

        /// <summary>Company-specific expense/COGS account PURCHASE lines post to.
        /// Null = the company default inventory-purchases account.</summary>
        public int? PurchaseAccountId { get; set; }
        public string? PurchaseAccountName { get; set; }

        /// <summary>
        /// When true (Item Catalog screen with a company selected), a POST/PUT
        /// with ?companyId=X upserts that company's overlay from DivisionId /
        /// Sale·PurchaseAccountId above. Left false by the bill-form quick-create
        /// paths — they pass companyId only for FBR enrichment and must NOT touch
        /// (or clear) the overlay.
        /// </summary>
        public bool WriteCompanyOverlay { get; set; }

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
