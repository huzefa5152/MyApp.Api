namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Allowlist of the business-document types an <see cref="Models.Attachment"/>
    /// may be linked to via <c>Attachment.EntityType</c>. Kept as a small closed
    /// set so a forged EntityType from the request body can't smuggle attachments
    /// onto arbitrary records. The reusable frontend attachment component passes
    /// one of these strings verbatim.
    /// </summary>
    public static class AttachmentEntityTypes
    {
        public const string SalesQuote = "SalesQuote";
        public const string SalesOrder = "SalesOrder";
        public const string DeliveryChallan = "DeliveryChallan";
        public const string Bill = "Bill";
        public const string Invoice = "Invoice";

        public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
        {
            SalesQuote, SalesOrder, DeliveryChallan, Bill, Invoice
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
