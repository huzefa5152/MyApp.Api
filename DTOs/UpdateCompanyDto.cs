namespace MyApp.Api.DTOs
{
    public class UpdateCompanyDto
    {
        public string Name { get; set; } = string.Empty;
        public string? BrandName { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public string? LogoPath { get; set; }
        public int StartingChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public string? InvoiceNumberPrefix { get; set; }
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrToken { get; set; }
        public string? FbrEnvironment { get; set; }
        public string? FbrDefaultSaleType { get; set; }
        public string? FbrDefaultUOM { get; set; }
        public string? FbrDefaultPaymentModeRegistered { get; set; }
        public string? FbrDefaultPaymentModeUnregistered { get; set; }

        // Inventory module toggle. Off by default. Flip on once the
        // operator has entered opening balances.
        public bool InventoryTrackingEnabled { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }

        // Tenant isolation flag. See CompanyDto for semantics.
        public bool IsTenantIsolated { get; set; }
    }
}
