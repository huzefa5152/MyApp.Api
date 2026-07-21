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
            // Receipt (money-in) is a template type now; the Receipt document +
            // screen land in Phase 3 (Accounting), at which point its on-screen
            // template selector is wired up.
            "Receipt",
        };

        /// <summary>Human-readable list for validation error messages.</summary>
        public static string AllForDisplay => string.Join(", ", All);
    }
}
