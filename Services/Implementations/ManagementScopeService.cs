using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// See <see cref="IManagementScopeService"/>. The whole (Id,
    /// CreatedByUserId) map is loaded once per request and cached for
    /// 60 s under a generation counter — the same pattern
    /// <see cref="PermissionService"/> and <see cref="CompanyAccessGuard"/>
    /// use. The Users table is tiny (a few rows per installation), so an
    /// in-memory walk is cheaper and clearer than a recursive CTE.
    /// </summary>
    public class ManagementScopeService : IManagementScopeService
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
        private const string TreeKeyPrefix = "mgmt-scope:tree";
        private const string GenerationKey = "mgmt-scope:generation";

        private readonly AppDbContext _context;
        private readonly IMemoryCache _cache;
        private readonly ICompanyAccessGuard _access;
        private readonly int _seedAdminUserId;

        public ManagementScopeService(
            AppDbContext context,
            IMemoryCache cache,
            ICompanyAccessGuard access,
            IConfiguration configuration)
        {
            _context = context;
            _cache = cache;
            _access = access;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public bool IsSeedAdmin(int userId) => userId == _seedAdminUserId;

        private long CurrentGeneration() =>
            _cache.GetOrCreate(GenerationKey, e =>
            {
                e.Priority = CacheItemPriority.NeverRemove;
                return 0L;
            });

        /// <summary>Id → CreatedByUserId for every user, cached.</summary>
        private async Task<Dictionary<int, int?>> GetParentMapAsync()
        {
            var key = $"{TreeKeyPrefix}:g{CurrentGeneration()}";
            if (_cache.TryGetValue<Dictionary<int, int?>>(key, out var cached) && cached is not null)
                return cached;

            var rows = await _context.Users
                .AsNoTracking()
                .Select(u => new { u.Id, u.CreatedByUserId })
                .ToListAsync();
            var map = rows.ToDictionary(r => r.Id, r => r.CreatedByUserId);

            _cache.Set(key, map, new MemoryCacheEntryOptions { SlidingExpiration = CacheTtl });
            return map;
        }

        public async Task<HashSet<int>> GetManageableUserIdsAsync(int userId)
        {
            var map = await GetParentMapAsync();
            if (IsSeedAdmin(userId))
                return map.Keys.ToHashSet();

            // Breadth-first walk down the CreatedBy chain. A cycle cannot
            // arise through the API (CreatedByUserId is stamped once at
            // create and only ever moved UP on re-parent), but the visited
            // set makes the walk safe against a hand-edited row anyway.
            var childrenOf = map
                .Where(kv => kv.Value.HasValue)
                .GroupBy(kv => kv.Value!.Value)
                .ToDictionary(g => g.Key, g => g.Select(kv => kv.Key).ToList());

            var result = new HashSet<int>();
            var queue = new Queue<int>();
            queue.Enqueue(userId);
            while (queue.Count > 0)
            {
                var current = queue.Dequeue();
                if (!childrenOf.TryGetValue(current, out var kids)) continue;
                foreach (var kid in kids)
                {
                    if (kid == userId || kid == _seedAdminUserId) continue;
                    if (result.Add(kid)) queue.Enqueue(kid);
                }
            }
            return result;
        }

        public async Task<HashSet<int>> GetVisibleUserIdsAsync(int userId)
        {
            var set = await GetManageableUserIdsAsync(userId);
            set.Add(userId);
            return set;
        }

        public async Task<bool> CanManageUserAsync(int actorUserId, int targetUserId)
        {
            if (IsSeedAdmin(actorUserId)) return true;
            if (IsSeedAdmin(targetUserId)) return false;
            var set = await GetManageableUserIdsAsync(actorUserId);
            return set.Contains(targetUserId);
        }

        public async Task<HashSet<int>> GetAssignableCompanyIdsAsync(int userId)
        {
            // Seed admin: CompanyAccessGuard already returns every company.
            // Anyone else: exactly what they hold themselves — nothing
            // more can be delegated.
            return await _access.GetAccessibleCompanyIdsAsync(userId);
        }

        public async Task<List<int>> GetAncestorUserIdsAsync(int userId)
        {
            var map = await GetParentMapAsync();
            var chain = new List<int>();
            var seen = new HashSet<int> { userId };
            var current = userId;
            while (map.TryGetValue(current, out var parent) && parent.HasValue)
            {
                var p = parent.Value;
                if (p == _seedAdminUserId || !seen.Add(p)) break;
                chain.Add(p);
                current = p;
            }
            return chain;
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
