using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

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

        /// <summary>Everything except opening balances. Apply to every query that
        /// counts SALES or lists bills / invoices / credit notes as documents: an
        /// opening balance is brought forward, not sold, and is managed only from
        /// Clients -> Opening balance.</summary>
        public static IQueryable<Invoice> NotOpening(this IQueryable<Invoice> q) =>
            q.Where(i => i.ExternalRef == null || !i.ExternalRef.StartsWith(Prefix));

        /// <summary>Only opening-balance documents.</summary>
        public static IQueryable<Invoice> OnlyOpening(this IQueryable<Invoice> q) =>
            q.Where(i => i.ExternalRef != null && i.ExternalRef.StartsWith(Prefix));

        /// <summary>
        /// THE A/R rule for a customer who had PAID AHEAD when their books started
        /// (a credit-note opening): that credit reduces what they owe. Receivable
        /// figures built from sale invoices (Clients A/R column, aged receivables,
        /// dashboard receivables, customer portal) exclude credit notes, so without
        /// this they report the advance as if it never existed while the ledger
        /// and the GL both carry it. Returns clientId -> credit still unused (positive).
        /// </summary>
        public static async Task<Dictionary<int, decimal>> PaidAheadByClientAsync(
            AppDbContext db, int companyId, int? clientId = null, DateTime? asOf = null)
        {
            var q = db.Invoices.AsNoTracking().OnlyOpening()
                .Where(i => i.CompanyId == companyId && i.DocumentType == 10 && !i.IsCancelled && !i.IsDemo);
            if (clientId.HasValue) q = q.Where(i => i.ClientId == clientId.Value);
            if (asOf.HasValue) q = q.Where(i => i.Date <= asOf.Value);
            return await q.GroupBy(i => i.ClientId)
                .Select(g => new { g.Key, Amt = g.Sum(i => i.GrandTotal - i.AmountPaid) })
                .Where(x => x.Amt != 0m)
                .ToDictionaryAsync(x => x.Key, x => x.Amt);
        }
    }
}
