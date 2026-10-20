namespace MyApp.Api.Helpers
{
    /// <summary>
    /// A customer's opening balance: what they owed (or had paid ahead) when the
    /// books started here. Stored as ONE migrated document per client, told apart
    /// from a sale by its <c>ExternalRef</c>:
    ///   owes us       → an invoice
    ///   paid ahead    → a credit note
    ///
    /// The prefix is the one the customer-ledger import already writes for its
    /// opening rows ("ledger-open:{company}:{row}"), so every place that keeps an
    /// opening balance out of sales (Invoice Sales Detail, the dashboards) and the
    /// posting rule (Retained earnings, never Sales) treat both the same way.
    /// </summary>
    public static class ClientOpeningBalance
    {
        public const string Prefix = "ledger-open:";

        /// <summary>The one document holding this client's opening balance.</summary>
        public static string Ref(int companyId, int clientId) => $"{Prefix}{companyId}:client-{clientId}";

        public static bool IsOpening(string? externalRef) =>
            externalRef != null && externalRef.StartsWith(Prefix, StringComparison.Ordinal);
    }
}
