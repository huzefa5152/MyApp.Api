using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Money a payment leaves sitting against a PARTY's running balance instead of
    /// against a document — an advance, or a refund that undoes one.
    ///
    /// <para>It reaches the books in TWO shapes, and every view that reports a
    /// party's position has to count both or it disagrees with the ledger:</para>
    /// <list type="bullet">
    ///   <item>an explicit <see cref="AllocationKind.OnAccount"/> allocation line
    ///   (money in or out, client or supplier); and</item>
    ///   <item>the unallocated remainder of a customer receipt. Payment.Amount is
    ///   authoritative for a receipt (2026-08-29) and a receipt may legitimately
    ///   carry NO allocation lines at all, so that remainder has no row of its
    ///   own.</item>
    /// </list>
    /// <para>PostingService.PostPaymentAsync posts both to the party's own control
    /// account (A/R for a client, A/P for a supplier), so this is the read-side
    /// mirror of that rule and lives in one place rather than three.</para>
    ///
    /// <para>One number per payment:</para>
    /// <code>
    /// onAccount = Payment.Amount − Σ(line.Amount where line.Kind != OnAccount)
    /// </code>
    /// <para>which is exactly Σ(OnAccount cash) + the unallocated remainder, and is
    /// 0 for an ordinary payment that spends all its cash on documents or expense
    /// accounts. Cash only: a settle-remainder AdjustmentAmount is non-cash, it
    /// clears the document rather than the payment, and it is not part of
    /// Payment.Amount.</para>
    /// </summary>
    public static class PartyOnAccount
    {
        /// <summary>One payment's on-account movement, with enough of the header to
        /// render a ledger line without a second query.</summary>
        public sealed class Row
        {
            public int PaymentId { get; set; }
            public int Number { get; set; }
            public DateTime Date { get; set; }
            public PaymentDirection Direction { get; set; }
            public int PartyId { get; set; }
            /// <summary>Unsigned cash held on account by this payment. The SIGN is
            /// the caller's, because it depends on which ledger is being read —
            /// see <see cref="NetByPartyAsync"/>.</summary>
            public decimal Amount { get; set; }
            public string? BankAccountName { get; set; }
            public string? Description { get; set; }
        }

        /// <param name="contactType">"Client" or "Supplier". Compared by SQL, so a
        /// legacy row stored as "client" still matches under the database's
        /// case-insensitive collation.</param>
        /// <param name="partyIds">Narrow to these parties. Pass the whole set a
        /// ClientGroup covers rather than querying once per member.</param>
        public static IQueryable<Row> Query(
            AppDbContext ctx, string contactType, int? companyId = null,
            ICollection<int>? partyIds = null)
        {
            var q = ctx.Payments.AsNoTracking()
                .Where(p => !p.IsCancelled && p.ContactId != null && p.ContactType == contactType);
            if (companyId.HasValue) q = q.Where(p => p.CompanyId == companyId.Value);
            if (partyIds != null) q = q.Where(p => partyIds.Contains(p.ContactId!.Value));

            return q.Select(p => new Row
            {
                PaymentId = p.Id,
                Number = p.Number,
                Date = p.Date,
                Direction = p.Direction,
                PartyId = p.ContactId!.Value,
                BankAccountName = p.BankAccountName,
                Description = p.Description,
                Amount = p.Amount - (p.Allocations
                    .Where(a => a.Kind != AllocationKind.OnAccount)
                    .Sum(a => (decimal?)a.Amount) ?? 0m),
            });
        }

        /// <summary>
        /// Signed net per party, ready to add to a balance derived from documents.
        /// </summary>
        /// <param name="receivables">
        /// True for the client side: money IN reduces what the customer owes, so a
        /// receipt is negative. False for the supplier side: money OUT reduces what
        /// we owe, so a payment is negative. "Reduces the balance" is the opposite
        /// direction of cash on each side, which is the whole reason for the flag.
        /// </param>
        public static async Task<Dictionary<int, decimal>> NetByPartyAsync(
            AppDbContext ctx, int companyId, bool receivables)
        {
            var rows = await Query(ctx, receivables ? "Client" : "Supplier", companyId).ToListAsync();
            return rows
                .Where(r => r.Amount != 0m)
                .GroupBy(r => r.PartyId)
                .ToDictionary(g => g.Key, g => g.Sum(r => Signed(r, receivables)));
        }

        /// <summary>The signed contribution of one row to the party's balance.
        /// See <see cref="NetByPartyAsync"/> for what <paramref name="receivables"/>
        /// means.</summary>
        public static decimal Signed(Row r, bool receivables) =>
            receivables
                ? (r.Direction == PaymentDirection.Receipt ? -r.Amount : r.Amount)
                : (r.Direction == PaymentDirection.Payment ? -r.Amount : r.Amount);
    }
}
