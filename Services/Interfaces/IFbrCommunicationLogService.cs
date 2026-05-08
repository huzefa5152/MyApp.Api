using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Backs the dedicated FBR monitoring trail. See audit H-3
    /// (AUDIT_2026_05_08_OBSERVABILITY.md) — pre-fix every FBR call
    /// dumped its request/response into AuditLogs alongside everything
    /// else, so admins couldn't isolate FBR health.
    /// </summary>
    public interface IFbrCommunicationLogService
    {
        /// <summary>Persist a single row. Never throws — failures fall
        /// through to the file sink so the FBR call itself isn't broken
        /// by a logging failure.</summary>
        Task LogAsync(FbrCommunicationLog row);

        Task<PagedResult<FbrCommunicationLogDto>> GetPagedAsync(
            int page, int pageSize,
            int? companyId = null,
            string? action = null,
            string? status = null,
            int? invoiceId = null,
            DateTime? since = null,
            DateTime? until = null);

        Task<FbrCommunicationLogDto?> GetByIdAsync(long id);

        /// <summary>Aggregate counts for the monitor dashboard top strip.
        /// Buckets by Status (sent/acknowledged/submitted/rejected/failed).
        /// </summary>
        Task<FbrCommunicationSummaryDto> GetSummaryAsync(int? companyId, DateTime since);
    }
}
