namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Canonical allowlist of print-template document types. The single source
    /// of truth the PrintTemplates controller validates against — the DB column
    /// is a free string, so this list is the only hard gate. The frontend mirror
    /// lives in <c>myapp-frontend/src/utils/templateSampleData.js</c>
    /// (TEMPLATE_TYPES) and each type's merge fields are seeded at startup
    /// (SalesMergeFieldSeeder / NoteAndPurchaseMergeFieldSeeder).
    /// </summary>
    public static class PrintTemplateTypes
    {
        public static readonly string[] All =
        {
            "Challan", "Bill", "TaxInvoice", "SalesQuote", "SalesOrder",
            "PurchaseBill", "GoodsReceipt", "DebitNote", "CreditNote",
            // Accounting vouchers. Receipt = money in (settles sales invoices),
            // Payment = money out (settles purchase bills). Separate types so a
            // payment voucher prints "Payment Voucher" (its own starters), not a
            // mislabeled Receipt. Both bind the same PrintPaymentVoucherDto; the
            // DTO's Direction distinguishes them.
            "Receipt", "Payment",
        };

        /// <summary>Human-readable list for validation error messages.</summary>
        public static string AllForDisplay => string.Join(", ", All);
    }
}
