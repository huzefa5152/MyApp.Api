using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The general ledger itself: the policy questions (is posting on, is this
    /// period open), the one place an entry is written, and the primitives every
    /// report reads instead of re-deriving balances of its own.
    ///
    /// It does NOT decide which legs a document produces — that is the posting
    /// engine's job. This service only guarantees that whatever is written is a
    /// balanced entry, in an open period, on accounts of the right company.
    ///
    /// All methods are company-scoped; controllers assert tenant access first.
    /// </summary>
    public interface IGeneralLedgerService
    {
        // ── Policy ────────────────────────────────────────────────────────────

        /// <summary>Whether this company's documents post to the ledger. Set at
        /// company creation and by the one-off back-post of a company that
        /// predates the module; there is deliberately no method to turn it
        /// off.</summary>
        Task<bool> IsEnabledAsync(int companyId);

        /// <summary>Throws when <paramref name="date"/> falls on or before the
        /// company's lock date. Every write into the ledger goes through this,
        /// including deleting an entry — a closed period stays closed in both
        /// directions.</summary>
        Task AssertPeriodOpenAsync(int companyId, DateTime date);

        Task<GlStatusDto> GetStatusAsync(int companyId);

        Task SetLockDateAsync(int companyId, DateTime? lockDate);

        // ── Writing ───────────────────────────────────────────────────────────

        /// <summary>
        /// What makes a set of lines a legal entry: at least two of them, an
        /// amount on exactly one side of each, no negatives, debits equal to
        /// credits, a non-zero total, and every account belonging to
        /// <paramref name="companyId"/>. Throws
        /// <see cref="InvalidOperationException"/> naming the first thing wrong.
        ///
        /// Public because an EDIT replaces an entry's lines in place rather than
        /// writing a new entry, and it has to be held to the same rule — the
        /// first version of this service enforced the invariant inside
        /// <see cref="WriteEntryAsync"/> only, and an unbalanced edit went
        /// straight through it into the ledger.
        /// </summary>
        Task AssertEntryIsLegalAsync(int companyId, IReadOnlyCollection<JournalLine> lines);

        /// <summary>
        /// Writes one entry, and is the ONLY place that does. Validates that the
        /// entry balances, that each line carries an amount on exactly one side,
        /// that every account belongs to the entry's company, and that the date
        /// is in an open period; then allocates <c>EntryNo</c>.
        ///
        /// For a system-posted entry (a non-null <c>SourceDocId</c>) this is
        /// replace-on-edit: any existing entry for the same
        /// (company, source type, source id) is removed first, so re-posting a
        /// document can never double it. Runs inside the caller's transaction
        /// when there is one.
        /// </summary>
        Task<JournalEntry> WriteEntryAsync(JournalEntry entry);

        /// <summary>Removes the system-posted entry for a document, if any, and
        /// returns how many entries went. Used when a document is deleted or
        /// voided. Refuses inside a closed period.</summary>
        Task<int> RemoveForDocumentAsync(int companyId, SourceDocType sourceDocType, int sourceDocId);

        // ── Reading ───────────────────────────────────────────────────────────

        /// <summary>Per-account balances, signed debit-positive: the account's
        /// opening balance plus all ledger movement up to <paramref name="asAt"/>
        /// (or all of it when null). The Chart of Accounts and every report read
        /// this rather than summing journal lines themselves.</summary>
        Task<Dictionary<int, decimal>> GetAccountBalancesAsync(int companyId, DateTime? asAt = null);

        /// <summary>One account's movement with a running balance, paged. Null
        /// when the account does not exist; the caller asserts tenant access
        /// against the returned CompanyId.</summary>
        Task<AccountLedgerDto?> GetAccountLedgerAsync(int accountId, DateTime? from, DateTime? to, int page, int pageSize);

        Task<TrialBalanceDto> GetTrialBalanceAsync(int companyId, DateTime? from, DateTime? to);
    }
}
