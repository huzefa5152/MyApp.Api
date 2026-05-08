namespace MyApp.Api.DTOs
{
    public class CreateCompanyDto
    {
        public string Name { get; set; } = string.Empty;
        public string? BrandName { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public int StartingChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public string? InvoiceNumberPrefix { get; set; }
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrToken { get; set; }
        public string? FbrEnvironment { get; set; }

        // Per-company FBR defaults — used by InvoiceService when a new bill
        // is created without an explicit SaleType / UOM / PaymentMode on the
        // incoming DTO. Null keeps the built-in fallback behaviour.
        public string? FbrDefaultSaleType { get; set; }
        public string? FbrDefaultUOM { get; set; }
        public string? FbrDefaultPaymentModeRegistered { get; set; }
        public string? FbrDefaultPaymentModeUnregistered { get; set; }

        // Inventory module toggle. Defaults to false on the backend if
        // omitted from the payload — operators turn it on when they're
        // ready to track stock movements.
        public bool InventoryTrackingEnabled { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }

        // Tenant isolation flag. See CompanyDto for semantics. Defaults to
        // false on a newly created company so existing flows keep working.
        public bool IsTenantIsolated { get; set; }
    }
}
