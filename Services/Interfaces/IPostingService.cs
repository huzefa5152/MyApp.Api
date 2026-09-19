using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The posting engine: what LEGS a document produces. It does not write
    /// entries itself — <see cref="IGeneralLedgerService.WriteEntryAsync"/> does
    /// that, and owns the balance invariant, the period guard and
    /// replace-on-edit. Keeping the two apart means there is exactly one place
    /// an entry can be written, however many documents learn to post.
    ///
    /// Every Post* method:
    ///   • is a NO-OP when the company's ledger is not live, so a company that
    ///     has not been back-posted is never half-posted;
    ///   • REPLACES the document's existing entry rather than adding to it, so
    ///     editing a bill five times books it once;
    ///   • REMOVES the entry when the document stops being a document — demo,
    ///     cancelled, or zero-total;
    ///   • resolves its accounts by <c>ControlType</c>, falling back to Suspense
    ///     so a chart missing a role account pools the difference somewhere
    ///     visible instead of failing the operator's save; and
    ///   • runs inside the CALLER's transaction. Callers invoke it after their
    ///     own SaveChanges and before commit.
    /// </summary>
    public interface IPostingService
    {
        /// <summary>Sales invoice: Dr A/R, Cr Sales, Cr Output tax, Cr Further
        /// tax payable, Dr WHT receivable. A credit note (DocumentType 10)
        /// reverses every leg; a debit note (9) posts in the sale direction.</summary>
        Task PostInvoiceAsync(Invoice invoice);

        /// <summary>Purchase bill: Dr Inventory (or COGS when the company does
        /// not track stock), Dr Input tax, Cr A/P, Cr WHT payable.</summary>
        Task PostPurchaseBillAsync(PurchaseBill bill);

        /// <summary>Receipt: Dr bank/cash, Cr A/R per settled invoice. Payment:
        /// the mirror image. Money not allocated to a document lands on the
        /// PARTY's own control account, which is where an advance belongs.</summary>
        Task PostPaymentAsync(Payment payment);

        /// <summary>Removes a document's entry. Called from the delete paths.
        /// Safe when there is none.</summary>
        Task RemoveForSourceAsync(int companyId, SourceDocType type, int sourceDocId);

        /// <summary>Makes sure the company has a default sales (income) and
        /// purchase (expense) account and pins them on the company. Idempotent:
        /// it adopts the seeded <c>seed:sales</c> / <c>seed:cogs</c> or any
        /// existing income/expense account before creating anything.</summary>
        Task EnsureDefaultAccountsAsync(int companyId);

        /// <summary>Re-posts every document of a company from scratch: removes
        /// the system-posted entries, leaves manual journals alone, and posts
        /// each document again. The repair hatch, and what the one-off
        /// back-post of an older company runs. Returns what it posted.</summary>
        Task<PostingRebuildResult> RebuildAsync(int companyId);
    }

    /// <summary>What a rebuild did, for the operator and for the suites.</summary>
    public class PostingRebuildResult
    {
        public int RemovedEntries { get; set; }
        public int PostedInvoices { get; set; }
        public int PostedPurchaseBills { get; set; }
        public int PostedPayments { get; set; }
    }
}
