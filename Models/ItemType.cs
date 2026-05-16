namespace MyApp.Api.Models
{
    /// <summary>
    /// An FBR-mapped product/item type. This is the user's curated catalog of
    /// items they sell — each entry carries FBR metadata (HS code, UOM, sale
    /// type) so every challan line or bill line that references it inherits
    /// those values automatically.
    ///
    /// Bills group items by this type (see PrintTaxInvoiceDto), and FBR
    /// submission pulls HSCode / UOM / SaleType from here when the item lacks
    /// its own overrides.
    /// </summary>
    public class ItemType
    {
        public int Id { get; set; }
        public string Name { get; set; } = null!;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // FBR Digital Invoicing metadata — filled when user picks an item from
        // FBR's catalog (https://gw.fbr.gov.pk/pdi/v1/itemdesccode)
        public string? HSCode { get; set; }
        public string? UOM { get; set; }          // human description (e.g. "Numbers, pieces, units")
        public int? FbrUOMId { get; set; }        // FBR UOM id (from /pdi/v1/uom)
        public string? SaleType { get; set; }     // e.g. "Goods at standard rate (default)"
        public string? FbrDescription { get; set; } // full FBR description of the HS code

        // Curation — lets the dropdowns show a shorter list of the items you
        // actually sell, instead of the full FBR catalog every time.
        public bool IsFavorite { get; set; } = true;
        public int UsageCount { get; set; }
        public DateTime? LastUsedAt { get; set; }

        /// <summary>
        /// True when this ItemType was auto-created from an FBR Annexure-A
        /// import row that only carried a 4-digit HS heading (e.g. "8301")
        /// instead of a full 8-digit PCT code (e.g. "8301.1000"). PRAL's
        /// /validateinvoicedata rejects 4-digit codes for sales (error
        /// 0052 — confirmed via sandbox 2026-05-08), so flagged ItemTypes
        /// must NOT be picked when creating a sales bill — the operator
        /// has to first edit the row and pick a real PCT code from the
        /// FBR catalog. Defaults false: existing manual ItemTypes were
        /// always entered with a real catalog code.
        /// </summary>
        public bool IsHsCodePartial { get; set; }

        /// <summary>
        /// Soft-delete flag. The InvoiceItems/PurchaseItems/StockMovements
        /// FKs are all Restrict, so we can't hard-delete a row once it's
        /// been used on a bill or moved stock. Setting IsDeleted=true
        /// hides the row from every catalog list/picker while preserving
        /// the historical references on already-submitted FBR invoices
        /// and the inventory ledger. The (Name, HSCode) unique index is
        /// filtered to IsDeleted=0 so a soft-deleted row never blocks
        /// re-creating the same item.
        /// </summary>
        public bool IsDeleted { get; set; }
    }
}
