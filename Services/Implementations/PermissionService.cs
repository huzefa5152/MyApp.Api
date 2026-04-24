using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class PermissionService : IPermissionService
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
        private const string CachePrefix = "perms:user:";
        // Sentinel key used so InvalidateAll can bump a generation counter
        // without enumerating every per-user cache entry.
        private const string GenerationKey = "perms:generation";

        private readonly AppDbContext _context;
        private readonly IMemoryCache _cache;
        private readonly int _seedAdminUserId;

        public PermissionService(AppDbContext context, IMemoryCache cache, IConfiguration configuration)
        {
            _context = context;
            _cache = cache;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public bool IsSeedAdmin(int userId) => userId == _seedAdminUserId;

        public async Task<bool> HasPermissionAsync(int userId, string permissionKey)
        {
            if (IsSeedAdmin(userId)) return true;
            var perms = await GetUserPermissionsAsync(userId);
            return perms.Contains(permissionKey);
        }

        public async Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId)
        {
            if (IsSeedAdmin(userId))
            {
                // Seed admin implicitly has every catalog key — no DB hit needed.
                return PermissionCatalog.All.Select(p => p.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            }

            var generation = _cache.GetOrCreate(GenerationKey, e =>
            {
                e.Priority = CacheItemPriority.NeverRemove;
                return 0L;
            });

            var cacheKey = $"{CachePrefix}{userId}:g{generation}";
            if (_cache.TryGetValue<HashSet<string>>(cacheKey, out var cached) && cached is not null)
                return cached;

            var perms = await _context.UserRoles
                .Where(ur => ur.UserId == userId)
                .SelectMany(ur => ur.Role!.RolePermissions)
                .Select(rp => rp.Permission!.Key)
                .Distinct()
                .ToListAsync();

            var set = new HashSet<string>(perms, StringComparer.OrdinalIgnoreCase);
            _cache.Set(cacheKey, set, new MemoryCacheEntryOptions
            {
                SlidingExpiration = CacheTtl
            });
            return set;
        }

        public void InvalidateUser(int userId)
        {
            // Current-generation key is removed; older-generation keys expire naturally.
            if (_cache.TryGetValue<long>(GenerationKey, out var gen))
            {
                _cache.Remove($"{CachePrefix}{userId}:g{gen}");
            }
        }

        public void InvalidateAll()
        {
            // Bumping the generation invalidates every per-user cache entry at once.
            var gen = _cache.GetOrCreate(GenerationKey, e =>
            {
                e.Priority = CacheItemPriority.NeverRemove;
                return 0L;
            });
            _cache.Set(GenerationKey, gen + 1, new MemoryCacheEntryOptions { Priority = CacheItemPriority.NeverRemove });
        }
    }
}
