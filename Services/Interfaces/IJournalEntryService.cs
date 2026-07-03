using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The Journal Entries module (design §11.1): a read view over the WHOLE
    /// general ledger (system-posted + manual entries) plus create/edit/delete
    /// of MANUAL journals only. System-posted entries belong to the posting
    /// engine — they are replaced when their source document changes and must
    /// be edited through that document, never here.
    /// </summary>
    public interface IJournalEntryService
    {
        /// <summary>All journal entries of a company (system-posted + manual),
        /// Date desc then EntryNo desc, lines included. search matches the
        /// narration or the entry number ("12" / "JE-0012"); manualOnly narrows
        /// to operator-authored entries.</summary>
        Task<PagedResult<JournalEntryDto>> GetPagedAsync(
            int companyId, int page, int pageSize, string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null, bool manualOnly = false);

        /// <summary>One entry with its lines + resolved account names. Null when
        /// not found — the controller asserts company access against the DTO.</summary>
        Task<JournalEntryDto?> GetByIdAsync(int id);

        /// <summary>Create a manual journal (SourceDocType.ManualJournal, no
        /// source document). Validates: GL posting enabled, period open, ≥ 2
        /// lines with exactly one side &gt; 0 each, balanced totals, accounts
        /// belong to the company + active + not bank/cash (those move money via
        /// receipts/payments/transfers), division belongs to the company.
        /// Allocates EntryNo (max+1 per company) under NumberAllocationRetry.
        /// Throws InvalidOperationException on validation failures.</summary>
        Task<JournalEntryDto> CreateManualAsync(int companyId, CreateJournalEntryDto dto);

        /// <summary>Full edit of a MANUAL journal: replace header + lines
        /// wholesale, keeping its EntryNo. Re-runs create's validations and the
        /// period-open guard on BOTH the stored and the incoming date (an entry
        /// can't move out of or into a locked period). Returns null when not
        /// found; throws when the entry is system-posted.</summary>
        Task<JournalEntryDto?> UpdateManualAsync(int id, CreateJournalEntryDto dto);

        /// <summary>Delete a MANUAL journal (lines cascade). Period-open guard
        /// on the stored date. Returns false when not found; throws when the
        /// entry is system-posted.</summary>
        Task<bool> DeleteManualAsync(int id);
    }
}
