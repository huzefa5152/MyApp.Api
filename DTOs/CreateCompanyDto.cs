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
        /// <summary>Starting number for the separate Debit/Credit Note sequence (Return Invoices). Defaults to 1.</summary>
        public int StartingDebitNoteNumber { get; set; } = 1;
        /// <summary>Starting number for the Credit Note sequence (returns/reversals). Defaults to 1.</summary>
        public int StartingCreditNoteNumber { get; set; } = 1;
        public string? InvoiceNumberPrefix { get; set; }
        public int? FbrProvinceCode { get; set; }
        public string? FbrBusinessActivity { get; set; }
        public string? FbrSector { get; set; }
        public string? FbrToken { get; set; }
        public string? FbrEnvironment { get; set; }

        /// <summary>
        /// Seller registration number FILED to FBR (SellerNTNCNIC): a 7-digit
        /// NTN or a 13-digit CNIC, entered exactly as filed at PRAL. Required
        /// and validated server-side — distinct from the display NTN/CNIC.
        /// </summary>
        public string? FbrSellerRegistrationNo { get; set; }

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
        public bool StockGuardHardBlock { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }
        /// <summary>Starting number for the Sales Quote sequence. Defaults to 1.</summary>
        public int StartingSalesQuoteNumber { get; set; } = 1;
        /// <summary>Starting number for the Sales Order sequence. Defaults to 1.</summary>
        public int StartingSalesOrderNumber { get; set; } = 1;

        // Tenant isolation flag. See CompanyDto for semantics. Defaults to
        // false on a newly created company so existing flows keep working.
        /// <summary>
        /// Nullable for the same reason as UpdateCompanyDto's: the company form
        /// stopped offering the switch (it decides no access; CompanyAccessGuard
        /// is fail-closed), so it sends no value. A non-nullable bool made an
        /// explicit null a DESERIALIZATION failure — "The JSON value could not
        /// be converted to System.Boolean" — which failed the whole DTO and
        /// broke company creation outright on 2026-09-21. Null means false here;
        /// on update it means "leave it alone".
        /// </summary>
        public bool? IsTenantIsolated { get; set; }
    }
}
