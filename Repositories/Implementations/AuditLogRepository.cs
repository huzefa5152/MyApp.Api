using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class AuditLogRepository : IAuditLogRepository
    {
        private readonly AppDbContext _context;

        public AuditLogRepository(AppDbContext context) => _context = context;

        public async Task<AuditLog> CreateAsync(AuditLog log)
        {
            _context.AuditLogs.Add(log);
            await _context.SaveChangesAsync();
            return log;
        }

        public async Task<PagedResult<AuditLog>> GetPagedAsync(int page, int pageSize, string? level = null, string? search = null,
            IReadOnlyCollection<int>? scopeCompanyIds = null)
        {
            // Defence-in-depth clamp (audit C-11) — controller already
            // clamps via PaginationHelper, but the repo is a public seam.
            page = Math.Max(1, page);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var query = Scope(_context.AuditLogs.AsNoTracking(), scopeCompanyIds);

            if (!string.IsNullOrWhiteSpace(level))
                query = query.Where(a => a.Level == level);

            if (!string.IsNullOrWhiteSpace(search))
                query = query.Where(a =>
                    a.RequestPath.Contains(search) ||
                    a.Message.Contains(search) ||
                    (a.UserName != null && a.UserName.Contains(search)));

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderByDescending(a => a.Timestamp)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return new PagedResult<AuditLog>
            {
                Items = items,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<AuditLog?> GetByIdAsync(int id, IReadOnlyCollection<int>? scopeCompanyIds = null)
            => await Scope(_context.AuditLogs.AsNoTracking(), scopeCompanyIds).FirstOrDefaultAsync(a => a.Id == id);

        /// <summary>
        /// Null = the seed admin, who sees the installation (including system
        /// rows with no company). Anyone else sees only rows written for the
        /// companies they can reach: a log row carries request bodies, query
        /// strings and stack traces, which are another tenant's data.
        /// </summary>
        private static IQueryable<AuditLog> Scope(IQueryable<AuditLog> q, IReadOnlyCollection<int>? scopeCompanyIds)
        {
            if (scopeCompanyIds == null) return q;
            var ids = scopeCompanyIds.ToList();
            return q.Where(a => a.CompanyId != null && ids.Contains(a.CompanyId.Value));
        }

        public async Task<int> GetCountByLevelAsync(string level, int hours = 24, IReadOnlyCollection<int>? scopeCompanyIds = null)
        {
            var since = DateTime.UtcNow.AddHours(-hours);
            return await Scope(_context.AuditLogs.AsNoTracking(), scopeCompanyIds)
                .CountAsync(a => a.Level == level && a.Timestamp >= since);
        }
    }
}
