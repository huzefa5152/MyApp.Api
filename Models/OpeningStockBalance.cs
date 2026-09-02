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
        // 2026-05-12: promoted alongside StockMovement.Quantity so
        // fractional UOMs (KG, Liter, Carat) can carry an accurate
        // opening balance. Stored as decimal(18,4).
        public decimal Quantity { get; set; }

        /// <summary>
        /// What that opening quantity is worth, excluding sales tax — the
        /// "Balance Excl" figure on the stock sheet. decimal(18,2): PKR is 2dp.
        ///
        /// Stored as a TOTAL rather than a unit cost because the sheet states a
        /// total, and deriving the unit cost (value ÷ quantity) loses nothing
        /// while the reverse would not round-trip.
        /// </summary>
        public decimal ValueExcludingTax { get; set; }

        /// <summary>
        /// Sales tax rate on that value, as a PERCENTAGE (18.00, 25.00) to match
        /// <see cref="Invoice.GSTRate"/>. The stock sheet writes it as a
        /// fraction (0.18); the importer converts.
        ///
        /// Tax is not held as its own column: every row of the client's sheet
        /// satisfies S.Tax = Excluding × Rate exactly, so storing it would be a
        /// second copy of a derived number, free to drift.
        /// </summary>
        public decimal SalesTaxRate { get; set; }

        public DateTime AsOfDate { get; set; }
        public string? Notes { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ItemType ItemType { get; set; } = null!;
    }
}
