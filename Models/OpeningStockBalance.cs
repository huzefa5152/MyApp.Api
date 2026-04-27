namespace MyApp.Api.Models
{
    /// <summary>
    /// Opening stock for an item at the moment a Company first turned
    /// InventoryTrackingEnabled on. Without this row, every existing
    /// Hakimi/Roshan item would show as massively negative on-hand
    /// (because they have years of sales history but no purchase data).
    ///
    /// Set ONCE per (Company, ItemType) — operators enter it via the
    /// Opening Balance screen. Treated as a synthetic stock IN movement
    /// dated <see cref="AsOfDate"/>: the Stock service emits a
    /// StockMovementSourceType.OpeningBalance row that carries this id,
    /// so the audit trail and the on-hand math stay consistent.
    /// </summary>
    public class OpeningStockBalance
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int ItemTypeId { get; set; }
        public int Quantity { get; set; }
        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ItemType ItemType { get; set; } = null!;
    }
}
