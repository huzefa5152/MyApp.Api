using MyApp.Api.Models;
using MyApp.Api.DTOs;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IAuditLogRepository
    {
        Task<AuditLog> CreateAsync(AuditLog log);
        /// <summary>
        /// <paramref name="companyScope"/> NULL means unrestricted — only the
        /// seed admin gets that. A non-null set restricts to rows carrying one of
        /// those companies; rows with no CompanyId are platform events (login
        /// failures, startup, anything outside a company context) and belong to
        /// whoever runs the software, so a scoped caller never sees them.
        /// </summary>
        Task<PagedResult<AuditLog>> GetPagedAsync(int page, int pageSize, string? level = null,
            string? search = null, IReadOnlyCollection<int>? companyScope = null);
        Task<AuditLog?> GetByIdAsync(int id);
        Task<int> GetCountByLevelAsync(string level, int hours = 24,
            IReadOnlyCollection<int>? companyScope = null);
    }
}
