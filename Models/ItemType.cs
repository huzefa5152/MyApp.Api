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
    }
}
