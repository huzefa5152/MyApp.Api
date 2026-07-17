namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for a per-company Non-Inventory Item (a GL-account shortcut
    /// line like "Freight Charges" / "Discount" — no stock, no FBR). The
    /// account-name fields are read-only projections for display; writes use
    /// the *AccountId fields (which must reference the same company's accounts).
    /// </summary>
    public class NonInventoryItemDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public string? UnitName { get; set; }

        public int? SaleAccountId { get; set; }
        public string? SaleAccountName { get; set; }
        public int? PurchaseAccountId { get; set; }
        public string? PurchaseAccountName { get; set; }

        public string? DefaultLineDescription { get; set; }
        public decimal? DefaultSalePrice { get; set; }
        public decimal? DefaultPurchasePrice { get; set; }
        public bool HideNameOnPrint { get; set; }
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; }
    }
}
