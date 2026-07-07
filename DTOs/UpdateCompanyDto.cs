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
        public int StartingSalesQuoteNumber { get; set; }
        public int StartingSalesOrderNumber { get; set; }
        /// <summary>Starting number for the separate Debit/Credit Note sequence (Return Invoices). Only honoured while the company has no notes yet.</summary>
        public int StartingDebitNoteNumber { get; set; } = 1;
        /// <summary>Starting number for the Credit Note sequence. Only honoured while the company has no credit notes yet.</summary>
        public int StartingCreditNoteNumber { get; set; } = 1;
        public string? InvoiceNumberPrefix { get; set; }
        public bool FbrEnabled { get; set; } = true;
        public bool RequireSalesOrderForBilling { get; set; } = false;
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
        // Hard-block over-commit/oversell (409) when tracking is on. See Q4.
        public bool StockGuardHardBlock { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }

        // Tenant isolation flag. See CompanyDto for semantics.
        public bool IsTenantIsolated { get; set; }
    }
}
