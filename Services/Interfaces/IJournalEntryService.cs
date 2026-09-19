using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// The Journal Entries module: a read view over the WHOLE general ledger
    /// (system-posted entries and manual journals alike) plus create, edit and
    /// delete of MANUAL journals only.
    ///
    /// A system-posted entry belongs to the posting engine. It is replaced when
    /// its source document changes, so editing it here would be undone by the
    /// next save of that document — the screen shows it and refuses to touch it.
    /// </summary>
    public interface IJournalEntryService
    {
        /// <summary>Every entry of a company, newest first (Date desc, then
        /// EntryNo desc), lines included. <paramref name="search"/> matches the
        /// narration or the entry number ("12" or "JE-0012");
        /// <paramref name="manualOnly"/> narrows to operator-authored
        /// entries.</summary>
        Task<PagedResult<JournalEntryDto>> GetPagedAsync(
            int companyId, int page, int pageSize, string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null, bool manualOnly = false);

        /// <summary>One entry with its lines and resolved account names. Null
        /// when not found — the controller asserts company access against the
        /// returned DTO, never against the id in the URL.</summary>
        Task<JournalEntryDto?> GetByIdAsync(int id);

        /// <summary>Create a manual journal. Validates that GL posting is on,
        /// the period is open, and the entry is a legal balanced entry; the
        /// balance and account-ownership rules live in
        /// <see cref="IGeneralLedgerService.WriteEntryAsync"/>, which is what
        /// actually writes it. Throws <see cref="InvalidOperationException"/> on
        /// any validation failure.</summary>
        Task<JournalEntryDto> CreateManualAsync(int companyId, CreateJournalEntryDto dto);

        /// <summary>Full edit of a MANUAL journal: header and lines are replaced
        /// wholesale and the EntryNo is kept. The period guard runs on BOTH the
        /// stored and the incoming date, so an entry can move neither out of nor
        /// into a closed period. Null when not found; throws when the entry is
        /// system-posted.</summary>
        Task<JournalEntryDto?> UpdateManualAsync(int id, CreateJournalEntryDto dto);

        /// <summary>Delete a MANUAL journal; its lines cascade. False when not
        /// found; throws when the entry is system-posted or its period is
        /// closed.</summary>
        Task<bool> DeleteManualAsync(int id);
    }
}
