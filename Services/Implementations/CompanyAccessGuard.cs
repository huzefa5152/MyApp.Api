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
        // Generation counter — bumping invalidates every per-user cache
        // entry at once. Same trick PermissionService uses.
        private const string GenerationKey = "company-access:generation";

        private readonly AppDbContext _context;
        private readonly IMemoryCache _cache;
        private readonly int _seedAdminUserId;

        public CompanyAccessGuard(AppDbContext context, IMemoryCache cache, IConfiguration configuration)
        {
            _context = context;
            _cache = cache;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        private long CurrentGeneration() =>
            _cache.GetOrCreate(GenerationKey, e =>
            {
                e.Priority = CacheItemPriority.NeverRemove;
                return 0L;
            });

        public async Task<bool> HasAccessAsync(int userId, int companyId)
        {
            if (userId == _seedAdminUserId) return true;
            // Single-source-of-truth: defer to the cached accessible-set
            // computation so the "explicit grants override open companies"
            // semantics are applied consistently. See
            // GetAccessibleCompanyIdsAsync for the rules.
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

            var cacheKey = $"{CachePrefix}{userId}:g{CurrentGeneration()}";
            if (_cache.TryGetValue<HashSet<int>>(cacheKey, out var cached) && cached is not null)
                return cached;

            // Fail-closed rule: a non-admin user sees ONLY the companies
            // listed in UserCompanies. No rows = no access.
            //
            // Existing users created before the Tenant Access UI shipped
            // are seeded one row per open company by the one-time backfill
            // in Program.cs (RBAC_USERCOMPANIES_BACKFILL_V1) so they don't
            // go dark on the upgrade. New users (post-backfill) start with
            // zero rows and see nothing until an operator explicitly
            // assigns them via Configuration → Tenant Access.
            //
            // The IsTenantIsolated flag on Company is now informational —
            // it was meaningful under the previous "open mode falls
            // through" semantics; under fail-closed it doesn't change
            // access decisions. Kept in the schema to preserve operator
            // intent and to drive the backfill (only OPEN companies are
            // auto-granted to existing users).
            var explicitGrants = await _context.UserCompanies
                .Where(uc => uc.UserId == userId)
                .Select(uc => uc.CompanyId)
                .ToListAsync();
            var set = new HashSet<int>(explicitGrants);

            _cache.Set(cacheKey, set, new MemoryCacheEntryOptions
            {
                SlidingExpiration = CacheTtl
            });
            return set;
        }

        public void InvalidateUser(int userId)
        {
            // Drop only the current-generation key. Older-generation keys
            // (from a previous InvalidateAll bump) expire naturally.
            _cache.Remove($"{CachePrefix}{userId}:g{CurrentGeneration()}");
        }

        public void InvalidateAll()
        {
            var gen = CurrentGeneration();
            _cache.Set(GenerationKey, gen + 1, new MemoryCacheEntryOptions
            {
                Priority = CacheItemPriority.NeverRemove
            });
        }
    }
}
