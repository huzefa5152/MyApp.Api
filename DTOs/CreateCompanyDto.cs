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
        public int StartingSalesQuoteNumber { get; set; }
        public int StartingSalesOrderNumber { get; set; }
        /// <summary>Starting number for the separate Debit/Credit Note sequence (Return Invoices). Defaults to 1.</summary>
        public int StartingDebitNoteNumber { get; set; } = 1;
        /// <summary>Starting number for the Credit Note sequence (returns/reversals). Defaults to 1.</summary>
        public int StartingCreditNoteNumber { get; set; } = 1;
        public string? InvoiceNumberPrefix { get; set; }
        public bool FbrEnabled { get; set; } = true;
        public bool RequireSalesOrderForBilling { get; set; } = false;
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
        // When true (with tracking on), over-commit/oversell is hard-blocked
        // (409) instead of a soft warning. Set on for V2 companies (Q4).
        public bool StockGuardHardBlock { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }

        // Tenant isolation flag. See CompanyDto for semantics. Defaults to
        // false on a newly created company so existing flows keep working.
        public bool IsTenantIsolated { get; set; }
    }
}
