namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Canonical allowlist of print-template document types. The single source
    /// of truth the PrintTemplates controller validates against — the DB column
    /// is a free string, so this list is the only hard gate. The frontend
    /// mirror lives in <c>myapp-frontend/src/pages/TemplateEditorPage.jsx</c>
    /// (TEMPLATE_TYPES) and each type's merge fields are seeded at startup
    /// (SalesMergeFieldSeeder / NoteAndPurchaseMergeFieldSeeder /
    /// DivisionMergeFieldSeeder).
    /// </summary>
    public static class PrintTemplateTypes
    {
        public static readonly string[] All =
        {
            "Challan", "Bill", "TaxInvoice", "SalesQuote", "SalesOrder",
            "DebitNote", "CreditNote", "PurchaseBill", "GoodsReceipt",
            // Accounting documents (2026-07). Receipt (money in) and Payment
            // (money out) are separate templates though they share the Payment
            // entity, since a receipt voucher and a payment voucher read
            // differently.
            "Receipt", "Payment", "Transfer", "JournalEntry", "WithholdingTaxReceipt",
        };

        /// <summary>Human-readable list for validation error messages.</summary>
        public static string AllForDisplay => string.Join(", ", All);
    }
}
