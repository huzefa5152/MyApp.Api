using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// See <see cref="ICompanyAccessGuard"/>. The cache is per-user with
    /// a 60s sliding TTL — same approach <see cref="PermissionService"/>
    /// uses, so changing a user's company assignments takes ≤60s to
    /// propagate. Acceptable for v1; tighten or invalidate explicitly if
    /// snappier propagation is needed.
    /// </summary>
    public class CompanyAccessGuard : ICompanyAccessGuard
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
        private const string CachePrefix = "company-access:user:";

        private readonly AppDbContext _context;
        private readonly IMemoryCache _cache;
        private readonly int _seedAdminUserId;

        public CompanyAccessGuard(AppDbContext context, IMemoryCache cache, IConfiguration configuration)
        {
            _context = context;
            _cache = cache;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public async Task<bool> HasAccessAsync(int userId, int companyId)
        {
            if (userId == _seedAdminUserId) return true;

            // Open companies (legacy behaviour): not isolated → any
            // authenticated user passes. The IsTenantIsolated flag is the
            // single switch that turns enforcement on per-company.
            var isIsolated = await _context.Companies
                .Where(c => c.Id == companyId)
                .Select(c => (bool?)c.IsTenantIsolated)
                .FirstOrDefaultAsync();
            if (isIsolated == null) return false; // company doesn't exist
            if (isIsolated == false) return true;

            var accessible = await GetAccessibleCompanyIdsAsync(userId);
            return accessible.Contains(companyId);
        }

        public async Task AssertAccessAsync(int userId, int companyId)
        {
            if (!await HasAccessAsync(userId, companyId))
            {
                throw new UnauthorizedAccessException(
                    $"You do not have access to company {companyId}.");
            }
        }

        public async Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int userId)
        {
            if (userId == _seedAdminUserId)
            {
                return await _context.Companies.Select(c => c.Id).ToHashSetAsync();
            }

            var cacheKey = $"{CachePrefix}{userId}";
            if (_cache.TryGetValue<HashSet<int>>(cacheKey, out var cached) && cached is not null)
                return cached;

            // Two sets unioned:
            //   1. all companies whose IsTenantIsolated=false  (legacy-open)
            //   2. companies whose UserCompany row grants this user
            var open = await _context.Companies
                .Where(c => !c.IsTenantIsolated)
                .Select(c => c.Id)
                .ToListAsync();

            var explicitGrants = await _context.UserCompanies
                .Where(uc => uc.UserId == userId)
                .Select(uc => uc.CompanyId)
                .ToListAsync();

            var set = new HashSet<int>(open.Concat(explicitGrants));
            _cache.Set(cacheKey, set, new MemoryCacheEntryOptions
            {
                SlidingExpiration = CacheTtl
            });
            return set;
        }
    }
}
