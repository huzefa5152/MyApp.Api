using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>GL operations that sit above the posting engine: enable/backfill,
    /// ledger status, account drill-down, trial balance, AR/AP aging and the
    /// accounting summary. All methods are company-scoped; controllers assert
    /// tenant access before calling.</summary>
    public interface IGeneralLedgerService
    {
        Task<GlStatusDto> GetStatusAsync(int companyId);

        /// <summary>Seeds the wholesale CoA when the company has none, flips
        /// GlPostingEnabled on, and backfills journal entries for every existing
        /// document. Idempotent — safe to run again.</summary>
        Task<GlEnableResultDto> EnableAsync(int companyId);

        /// <summary>Wipes all system-posted entries (manual journals survive)
        /// and re-posts every document. The repair hatch.</summary>
        Task<GlEnableResultDto> RebuildAsync(int companyId);

        Task SetLockDateAsync(int companyId, DateTime? lockDate);

        Task<AccountLedgerDto?> GetAccountLedgerAsync(int accountId, DateTime? from, DateTime? to, int page, int pageSize);

        Task<TrialBalanceDto> GetTrialBalanceAsync(int companyId, DateTime? from, DateTime? to);

        Task<AgedReportDto> GetAgedReceivablesAsync(int companyId);
        Task<AgedReportDto> GetAgedPayablesAsync(int companyId);

        Task<AccountingSummaryDto> GetSummaryAsync(int companyId, DateTime? from, DateTime? to);

        /// <summary>Per-account debit-positive balances (opening + all movement
        /// up to <paramref name="asAt"/>, or all-time when null). Used by the
        /// CoA tree.</summary>
        Task<Dictionary<int, decimal>> GetAccountBalancesAsync(int companyId, DateTime? asAt = null);
    }
}
