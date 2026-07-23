namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Allowlist of the business-document types an <see cref="Models.Attachment"/>
    /// may be linked to via <c>Attachment.EntityType</c>. Kept as a small closed
    /// set so a forged EntityType from the request body can't smuggle attachments
    /// onto arbitrary records. The reusable frontend attachment component passes
    /// one of these strings verbatim.
    ///
    /// NOTE: master ships only the document types that exist on this branch.
    /// Adding a new attachable type needs TWO edits: (1) add the const + list
    /// entry here, AND (2) add a case to the existence switch in
    /// <c>AttachmentService.UploadAsync</c> — miss (2) and uploads 400 with
    /// "The linked record was not found in this company".
    /// </summary>
    public static class AttachmentEntityTypes
    {
        public const string SalesQuote = "SalesQuote";
        public const string SalesOrder = "SalesOrder";
        public const string DeliveryChallan = "DeliveryChallan";
        // Bills, invoices, and credit/debit notes are all rows of the Invoice
        // entity (different tabs / DocumentTypes), so they share one type — an
        // attachment made on the Bills tab is visible on the Invoices tab.
        public const string Invoice = "Invoice";
        public const string PurchaseBill = "PurchaseBill";
        public const string GoodsReceipt = "GoodsReceipt";
        // A Receipt (money in) and a Payment (money out) are both rows of the
        // single Payment entity (distinguished by Direction), so they share ONE
        // type — mirroring how Invoice covers bills/invoices/notes.
        public const string Payment = "Payment";

        /// <summary>
        /// Pseudo-source meaning "no entity link" (EntityType IS NULL) — a file
        /// uploaded straight into a folder. NOT a member of <see cref="All"/>;
        /// used only as a source filter/summary key, never stored on a row.
        /// </summary>
        public const string DirectSource = "Direct";

        public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
        {
            SalesQuote, SalesOrder, DeliveryChallan, Invoice, PurchaseBill, GoodsReceipt, Payment
        };

        /// <summary>
        /// Returns the canonical (correctly-cased) entity type when the supplied
        /// value matches one of the allowed types (case-insensitively); otherwise
        /// null. Callers store the returned canonical value.
        /// </summary>
        public static string? Canonical(string? entityType)
        {
            if (string.IsNullOrWhiteSpace(entityType)) return null;
            var trimmed = entityType.Trim();
            foreach (var t in All)
                if (string.Equals(t, trimmed, StringComparison.OrdinalIgnoreCase))
                    return t;
            return null;
        }

        public static bool IsValid(string? entityType) => Canonical(entityType) != null;
    }
}
