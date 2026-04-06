using MyApp.Api.Models;
using MyApp.Api.DTOs;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IAuditLogRepository
    {
        Task<AuditLog> CreateAsync(AuditLog log);
        Task<PagedResult<AuditLog>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null);
        Task<AuditLog?> GetByIdAsync(int id);
        Task<int> GetCountByLevelAsync(string level, int hours = 24);
    }
}
