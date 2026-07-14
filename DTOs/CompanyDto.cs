namespace MyApp.Api.DTOs
{
    public class CompanyDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public int CurrentInvoiceNumber { get; set; }
        public int StartingDebitNoteNumber { get; set; }
        public int CurrentDebitNoteNumber { get; set; }
        public int StartingCreditNoteNumber { get; set; }
        public int CurrentCreditNoteNumber { get; set; }
        public string? InvoiceNumberPrefix { get; set; }
        // Sales Quote + Sales Order numbering (pre-sale documents). HasSalesQuotes /
        // HasSalesOrders let the UI lock the Starting* field once a document of
        // that type exists — same rule as challans / invoices.
        public int StartingSalesQuoteNumber { get; set; }
        public int CurrentSalesQuoteNumber { get; set; }
        public int StartingSalesOrderNumber { get; set; }
        public int CurrentSalesOrderNumber { get; set; }
        public bool HasSalesQuotes { get; set; }
        public bool HasSalesOrders { get; set; }
        public bool FbrEnabled { get; set; } = true;
        public bool RequireSalesOrderForBilling { get; set; } = false;
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrEnvironment { get; set; }
        public bool HasFbrToken { get; set; }
        public bool HasChallans { get; set; }
        public bool HasInvoices { get; set; }
        public string? FbrDefaultSaleType { get; set; }
        public string? FbrDefaultUOM { get; set; }
        public string? FbrDefaultPaymentModeRegistered { get; set; }
        public string? FbrDefaultPaymentModeUnregistered { get; set; }

        // ── GL posting defaults (read-only projection) ──────────────
        // The company-wide fallback accounts sale / purchase lines post to when
        // an item type carries no per-company account overlay. Managed by the
        // GL enable hook (PostingService.EnsureDefaultInventoryAccountsAsync),
        // NOT writable via company create/update. Surfaced so the bill forms can
        // NAME the account an unmapped line will land in ("→ Inventory – sales").
        // Null when GL posting has never been enabled for the company.
        public int? DefaultSalesAccountId { get; set; }
        public int? DefaultPurchaseAccountId { get; set; }

        // ── Inventory module toggles ──────────────────────────────
        // Off by default. While off, no Stock movements are emitted by
        // PurchaseBill saves or FBR submissions, and the stock guard at
        // FBR submission is silent. Operators flip this on once they've
        // entered opening balances and are ready to track inventory.
        public bool InventoryTrackingEnabled { get; set; }
        // Hard-block over-commit/oversell (409) when tracking is on (Q4).
        public bool StockGuardHardBlock { get; set; }
        // Inventory tracking version: 1 = legacy (only HS-coded items tracked),
        // 2 = standard (all item types are inventory). Drives the V1/V2 toggle.
        public byte InventoryFlowVersion { get; set; } = 1;
        public int StartingPurchaseBillNumber { get; set; }
        public int CurrentPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }
        public int CurrentGoodsReceiptNumber { get; set; }

        // ── Tenant isolation switch ─────────────────────────────────
        // false (default) → any authenticated user with the right RBAC
        // permission can reach this company (legacy/open).
        // true → only users with a UserCompanies row pass the access
        // guard. The seed admin always bypasses.
        public bool IsTenantIsolated { get; set; }
    }
}
