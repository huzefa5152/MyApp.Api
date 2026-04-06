using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class AuditLogService : IAuditLogService
    {
        private readonly IAuditLogRepository _repository;

        public AuditLogService(IAuditLogRepository repository) => _repository = repository;

        private static AuditLogDto ToDto(AuditLog a) => new()
        {
            Id = a.Id,
            Timestamp = a.Timestamp,
            Level = a.Level,
            UserName = a.UserName,
            HttpMethod = a.HttpMethod,
            RequestPath = a.RequestPath,
            StatusCode = a.StatusCode,
            ExceptionType = a.ExceptionType,
            Message = a.Message,
            StackTrace = a.StackTrace,
            RequestBody = a.RequestBody,
            QueryString = a.QueryString
        };

        public async Task LogAsync(AuditLog log)
        {
            try
            {
                await _repository.CreateAsync(log);
            }
            catch
            {
                // Swallow — logging must never crash the app
            }
        }

        public async Task<PagedResult<AuditLogDto>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null)
        {
            var result = await _repository.GetPagedAsync(page, pageSize, level, search);
            return new PagedResult<AuditLogDto>
            {
                Items = result.Items.Select(ToDto).ToList(),
                TotalCount = result.TotalCount,
                Page = result.Page,
                PageSize = result.PageSize
            };
        }

        public async Task<AuditLogDto?> GetByIdAsync(int id)
        {
            var log = await _repository.GetByIdAsync(id);
            return log == null ? null : ToDto(log);
        }

        public async Task<AuditSummaryDto> GetSummaryAsync()
        {
            return new AuditSummaryDto
            {
                ErrorsLast24h = await _repository.GetCountByLevelAsync("Error", 24),
                WarningsLast24h = await _repository.GetCountByLevelAsync("Warning", 24)
            };
        }
    }
}
