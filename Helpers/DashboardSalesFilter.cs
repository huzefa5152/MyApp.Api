using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The ONE definition of "a sale" for every dashboard sales figure
    /// (2026-10-18). Excludes demo, cancelled and FBR-cancelled documents.
    /// Debit / credit notes (DocumentType 9 / 10) are INCLUDED and SIGNED
    /// (credit -, debit +) rather than excluded, so a reversed sale nets off.
    /// Division scope stays with the caller. Dates: from inclusive, to exclusive.
    /// </summary>
    public static class DashboardSalesFilter
    {
        public static IQueryable<Invoice> SaleDocs(
            IQueryable<Invoice> q, int companyId, DateTime? from, DateTime? to)
        {
            q = q.Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                          && i.FbrCancelledAt == null
                          // A customer's opening balance is brought forward, not sold.
                          && (i.ExternalRef == null || !i.ExternalRef.StartsWith(ClientOpeningBalance.Prefix)));
            if (from.HasValue) q = q.Where(i => i.Date >= from.Value);
            if (to.HasValue)   q = q.Where(i => i.Date < to.Value);
            return q;
        }

        /// <summary>+1 for a sale or debit note, -1 for a credit note.</summary>
        public static decimal Sign(Invoice i) => i.DocumentType == 10 ? -1m : 1m;
    }
}
