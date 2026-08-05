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
        // FBR master switch. Defaults OFF for newly created companies (the
        // product now onboards non-FBR wholesalers first); the operator turns
        // it ON in the FBR tab when the company files digital invoices. This
        // default only applies to a create payload that omits the field —
        // existing companies keep whatever is already stored.
        public bool FbrEnabled { get; set; } = false;
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

        // Inventory module toggle. Defaults ON for newly created companies so
        // stock is tracked from day one; the operator can turn it off in the
        // Inventory tab.
        public bool InventoryTrackingEnabled { get; set; } = true;
        // Inventory tracking policy version for a NEW company. Defaults to 2
        // (V2 — every item type is inventory; HS code is FBR metadata only).
        // 1 = V1 legacy (only HS-coded item types tracked). Only applied on the
        // create path; existing companies change version via the audited
        // StockController flow-version toggle.
        public byte InventoryFlowVersion { get; set; } = 2;
        // When true (with tracking on), over-commit/oversell is hard-blocked
        // (409) instead of a soft warning. Left OFF by default so a brand-new
        // (zero-stock) company can still bill with a soft warning; the operator
        // turns it on in the Inventory tab.
        public bool StockGuardHardBlock { get; set; }

        // General Ledger master switch for a NEW company. Defaults ON: on the
        // create path the service runs the GL enable flow (seeds the Chart of
        // Accounts + turns posting on) so the books exist from day one. Set
        // false to create the company with GL off and enable it later from the
        // Accounting page. Only consulted when a company is created.
        public bool EnableGl { get; set; } = true;

        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }

        // Tenant isolation flag. See CompanyDto for semantics. Defaults to
        // false on a newly created company so existing flows keep working.
        public bool IsTenantIsolated { get; set; }
    }
}
