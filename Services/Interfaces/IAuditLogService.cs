using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    public interface IAuditLogService
    {
        Task LogAsync(AuditLog log);
        /// <summary>
        /// <paramref name="companyScope"/> NULL is unrestricted and is for the
        /// seed admin only. Everyone else passes the companies they can reach;
        /// rows with no CompanyId are platform events and stay out of scope.
        /// </summary>
        Task<PagedResult<AuditLogDto>> GetPagedAsync(int page, int pageSize, string? level = null,
            string? search = null, IReadOnlyCollection<int>? companyScope = null);
        Task<AuditLogDto?> GetByIdAsync(int id, IReadOnlyCollection<int>? companyScope = null);
        Task<AuditSummaryDto> GetSummaryAsync(IReadOnlyCollection<int>? companyScope = null);
    }
}
