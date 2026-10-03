using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    public interface IAuditLogService
    {
        Task LogAsync(AuditLog log);
        Task<PagedResult<AuditLogDto>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null,
            IReadOnlyCollection<int>? scopeCompanyIds = null);
        Task<AuditLogDto?> GetByIdAsync(int id, IReadOnlyCollection<int>? scopeCompanyIds = null);
        Task<AuditSummaryDto> GetSummaryAsync(IReadOnlyCollection<int>? scopeCompanyIds = null);
    }
}
