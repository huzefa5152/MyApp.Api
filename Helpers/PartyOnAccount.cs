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
    ///
    /// <para>This file owns ONE question — how much of a payment's cash reaches
    /// the party's own control account — in two flavours, because the two views
    /// that ask it want different slices of the same answer:</para>
    /// <list type="bullet">
    ///   <item><see cref="Query"/> — the on-account part ALONE, for a view that
    ///   already accounts for document settlement some other way (the A/R and
    ///   A/P columns net it against invoice/bill balances; the customer portal
    ///   nets it against the invoice balances it shows).</item>
    ///   <item><see cref="ControlAccountQuery"/> — on-account cash PLUS the cash
    ///   that settled the party's own documents, for a running-balance ledger
    ///   that lists documents at their full value and shows the money received
    ///   against them as its own row.</item>
    /// </list>
    /// <para>Four copies of the first formula is how two of them silently drifted
    /// (the customer portal reported every explicit advance as zero; the customer
    /// ledger charged customers for cash sales booked against their name). Add a
    /// caller here rather than a fifth copy elsewhere — and if a genuinely
    /// separate expression is ever unavoidable, pin it against this one with a
    /// test, the way suite 16 of test_customer_receipts_ledger.py pins
    /// PaymentService.OnAccountCash.</para>
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
            public string? Method { get; set; }
            public string? BankAccountName { get; set; }
            public string? Description { get; set; }
        }

        /// <param name="contactType">"Client" or "Supplier". Compared by SQL, so a
        /// legacy row stored as "client" still matches under the database's
        /// case-insensitive collation — which is why PostingService normalises the
        /// same value case-insensitively before choosing where to post.</param>
        /// <param name="companyId">REQUIRED, and deliberately not optional:
        /// <c>Payment.ContactId</c> is a soft reference with no FK, so a row in
        /// another tenant naming this party's id would otherwise be picked up.
        /// Every caller has a company in hand; making this defaultable is how one
        /// call site silently lost its scope once already.</param>
        /// <param name="partyIds">Narrow to these parties. Pass the whole set a
        /// ClientGroup covers rather than querying once per member.</param>
        public static IQueryable<Row> Query(
            AppDbContext ctx, string contactType, int companyId,
            ICollection<int>? partyIds = null) =>
            Scoped(ctx, contactType, companyId, partyIds)
                .Select(p => new Row
                {
                    PaymentId = p.Id,
                    Number = p.Number,
                    Date = p.Date,
                    Direction = p.Direction,
                    PartyId = p.ContactId!.Value,
                    Method = p.Method,
                    BankAccountName = p.BankAccountName,
                    Description = p.Description,
                    Amount = p.Amount - (p.Allocations
                        .Where(a => a.Kind != AllocationKind.OnAccount)
                        .Sum(a => (decimal?)a.Amount) ?? 0m),
                });

        /// <summary>
        /// Cash from one payment that lands on the party's OWN control account —
        /// A/R for a client, A/P for a supplier. That is <see cref="Query"/>'s
        /// on-account cash PLUS the cash that settled one of the party's own
        /// documents, and it is what a party's running-balance ledger must show
        /// against them:
        /// <code>
        /// controlCash = Payment.Amount − Σ(line.Amount that posts SOMEWHERE ELSE)
        /// </code>
        ///
        /// <para>"Somewhere else" is read straight off
        /// <c>PostingService.PostPaymentAsync</c>, which is the authority on where
        /// each line's cash goes:</para>
        /// <list type="bullet">
        ///   <item>a document line for THIS party's side (a sales invoice for a
        ///   client, a purchase bill for a supplier) → the party's control
        ///   account. Counted.</item>
        ///   <item><see cref="AllocationKind.OnAccount"/>, and the unallocated
        ///   remainder of a receipt → the party's control account. Counted (this
        ///   is <see cref="Query"/>'s quantity).</item>
        ///   <item><see cref="AllocationKind.Account"/> — a direct income/expense
        ///   line, the everyday cash sale or paid-in-cash expense → the account
        ///   the operator picked, NEVER the subledger. NOT counted.</item>
        ///   <item>a document line for the OTHER side (a purchase bill on a
        ///   client's receipt) → that document's own control account, with the
        ///   party tag dropped. NOT counted.</item>
        /// </list>
        ///
        /// <para>Debiting the raw <c>Payment.Amount</c> instead — as the customer
        /// ledger did until 2026-08-31 — books a cash sale recorded against a
        /// customer as if the customer had paid it, so the ledger invents an
        /// advance nobody holds and disagrees with the A/R column
        /// (<c>ClientService.GetSummaryAsync</c>) for the same customer.</para>
        ///
        /// <para>Cash only, for the same reason as <see cref="Query"/>: an
        /// AdjustmentAmount is a non-cash write-off that clears the DOCUMENT and
        /// is not part of <c>Payment.Amount</c>. A ledger that shows adjustments
        /// adds them as their own rows.</para>
        /// </summary>
        public static IQueryable<Row> ControlAccountQuery(
            AppDbContext ctx, string contactType, int companyId,
            ICollection<int>? partyIds = null)
        {
            var scoped = Scoped(ctx, contactType, companyId, partyIds);

            // Which document side belongs to this party. Kept explicit rather
            // than "any document line", because a purchase bill settled from a
            // client's receipt posts to Accounts payable and is not that
            // client's money.
            return contactType == "Supplier"
                ? scoped.Select(p => new Row
                {
                    PaymentId = p.Id,
                    Number = p.Number,
                    Date = p.Date,
                    Direction = p.Direction,
                    PartyId = p.ContactId!.Value,
                    Method = p.Method,
                    BankAccountName = p.BankAccountName,
                    Description = p.Description,
                    Amount = p.Amount - (p.Allocations
                        .Where(a => a.PurchaseBillId == null && a.Kind != AllocationKind.OnAccount)
                        .Sum(a => (decimal?)a.Amount) ?? 0m),
                })
                : scoped.Select(p => new Row
                {
                    PaymentId = p.Id,
                    Number = p.Number,
                    Date = p.Date,
                    Direction = p.Direction,
                    PartyId = p.ContactId!.Value,
                    Method = p.Method,
                    BankAccountName = p.BankAccountName,
                    Description = p.Description,
                    Amount = p.Amount - (p.Allocations
                        .Where(a => a.InvoiceId == null && a.Kind != AllocationKind.OnAccount)
                        .Sum(a => (decimal?)a.Amount) ?? 0m),
                });
        }

        /// <summary>The party/company/cancelled scope both projections share.
        /// One place, so a call site cannot pick up a different payment set by
        /// accident.</summary>
        private static IQueryable<Payment> Scoped(
            AppDbContext ctx, string contactType, int companyId, ICollection<int>? partyIds)
        {
            var q = ctx.Payments.AsNoTracking()
                .Where(p => !p.IsCancelled && p.ContactId != null
                            && p.ContactType == contactType && p.CompanyId == companyId);
            if (partyIds != null) q = q.Where(p => partyIds.Contains(p.ContactId!.Value));
            return q;
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
