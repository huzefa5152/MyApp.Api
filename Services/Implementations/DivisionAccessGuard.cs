using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// See <see cref="IDivisionAccessGuard"/>. Same cache shape as
    /// <see cref="CompanyAccessGuard"/>: per-user entry, 60s sliding TTL,
    /// generation counter for invalidate-all. One cached structure holds the
    /// user's restrictions across ALL companies so a request that touches
    /// several divisions costs at most one DB round-trip per minute.
    /// </summary>
    public class DivisionAccessGuard : IDivisionAccessGuard
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
        private const string CachePrefix = "division-access:user:";
        private const string GenerationKey = "division-access:generation";

        private readonly AppDbContext _context;
        private readonly IMemoryCache _cache;
        private readonly int _seedAdminUserId;

        public DivisionAccessGuard(AppDbContext context, IMemoryCache cache, IConfiguration configuration)
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

        public async Task<Dictionary<int, HashSet<int>>> GetRestrictionsAsync(int userId)
        {
            // Seed admin is never restricted.
            if (userId == _seedAdminUserId) return new Dictionary<int, HashSet<int>>();

            var cacheKey = $"{CachePrefix}{userId}:g{CurrentGeneration()}";
            if (_cache.TryGetValue<Dictionary<int, HashSet<int>>>(cacheKey, out var cached) && cached is not null)
                return cached;

            var restrictedCompanyIds = await _context.UserCompanies
                .Where(uc => uc.UserId == userId && uc.RestrictToDivisions)
                .Select(uc => uc.CompanyId)
                .ToListAsync();

            Dictionary<int, HashSet<int>> map;
            if (restrictedCompanyIds.Count == 0)
            {
                map = new Dictionary<int, HashSet<int>>();
            }
            else
            {
                // Bucket the user's division grants by the division's company.
                // A restricted company with zero grants yields an EMPTY set —
                // fail-closed within the restriction (the flag says "listed
                // divisions only" and nothing is listed).
                var grants = await _context.UserDivisions
                    .Where(ud => ud.UserId == userId)
                    .Select(ud => new { ud.DivisionId, ud.Division!.CompanyId })
                    .ToListAsync();
                map = restrictedCompanyIds.ToDictionary(
                    cid => cid,
                    cid => grants.Where(g => g.CompanyId == cid).Select(g => g.DivisionId).ToHashSet());
            }

            _cache.Set(cacheKey, map, new MemoryCacheEntryOptions
            {
                SlidingExpiration = CacheTtl
            });
            return map;
        }

        public async Task<HashSet<int>?> GetAccessibleDivisionIdsAsync(int userId, int companyId)
        {
            var restrictions = await GetRestrictionsAsync(userId);
            return restrictions.TryGetValue(companyId, out var set) ? set : null;
        }

        public async Task<bool> HasAccessAsync(int userId, int companyId, int? divisionId)
        {
            var set = await GetAccessibleDivisionIdsAsync(userId, companyId);
            if (set == null) return true;                    // unrestricted
            if (!divisionId.HasValue) return true;           // company-level record — policy D1
            return set.Contains(divisionId.Value);
        }

        public async Task AssertAccessAsync(int userId, int companyId, int? divisionId)
        {
            if (!await HasAccessAsync(userId, companyId, divisionId))
            {
                throw new UnauthorizedAccessException(
                    $"You do not have access to division {divisionId} of company {companyId}.");
            }
        }

        public async Task AssertWriteAccessAsync(int userId, int companyId, int? divisionId)
        {
            var set = await GetAccessibleDivisionIdsAsync(userId, companyId);
            if (set == null) return;                          // unrestricted
            if (!divisionId.HasValue)
            {
                // Policy D2: a restricted user can't write company-level
                // records — that would make the restriction cosmetic.
                throw new UnauthorizedAccessException(
                    "Your access is limited to specific divisions — pick one of your divisions for this document.");
            }
            if (!set.Contains(divisionId.Value))
            {
                throw new UnauthorizedAccessException(
                    $"You do not have access to division {divisionId} of company {companyId}.");
            }
        }

        public void InvalidateUser(int userId)
        {
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
