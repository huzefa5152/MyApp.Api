using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    public interface IAuditLogService
    {
        Task LogAsync(AuditLog log);
        Task<PagedResult<AuditLogDto>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null);
        Task<AuditLogDto?> GetByIdAsync(int id);
        Task<AuditSummaryDto> GetSummaryAsync();
    }
}
