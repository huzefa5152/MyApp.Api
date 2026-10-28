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

        // The two MCP keys are a premium opt-in, not a business permission: they follow the
        // account's MCP access policy on every request (never the cross-request cache), and
        // the seed admin is NOT short-circuited for them, so even the primary admin's agents
        // can be switched off.
        private static bool IsMcpKey(string key) =>
            string.Equals(key, "mcp.access.use", StringComparison.OrdinalIgnoreCase)
            || string.Equals(key, "mcp.write.use", StringComparison.OrdinalIgnoreCase);

        private readonly Dictionary<int, MyApp.Api.Models.McpUserAccessPolicy?> _requestMcpPolicies = new();
        private readonly Dictionary<int, HashSet<string>> _requestPermissions = new();

        private async Task<MyApp.Api.Models.McpUserAccessPolicy?> McpPolicyAsync(int userId)
        {
            if (!_requestMcpPolicies.TryGetValue(userId, out var policy))
                _requestMcpPolicies[userId] = policy = await _context.McpUserAccessPolicies.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == userId);
            return policy;
        }

        public async Task<bool> HasPermissionAsync(int userId, string permissionKey)
        {
            if (IsSeedAdmin(userId) && !IsMcpKey(permissionKey)) return true;
            var perms = await GetUserPermissionsAsync(userId);
            return perms.Contains(permissionKey);
        }

        public async Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId)
        {
            if (userId <= 0) return Array.Empty<string>();
            if (_requestPermissions.TryGetValue(userId, out var done)) return done;
            var set = new HashSet<string>(await RolePermissionsAsync(userId), StringComparer.OrdinalIgnoreCase);
            if (IsSeedAdmin(userId))
            {
                // Every business key, but the MCP keys only through a real grant.
                var viaRoles = set.Where(IsMcpKey).ToList();
                set = PermissionCatalog.All.Select(p => p.Key).Where(k => !IsMcpKey(k)).ToHashSet(StringComparer.OrdinalIgnoreCase);
                set.UnionWith(viaRoles);
            }
            var policy = await McpPolicyAsync(userId);
            if (policy != null)
            {
                set.RemoveWhere(IsMcpKey);
                if (policy.AccessGranted && policy.AccessEnabled)
                {
                    set.Add("mcp.access.use");
                    if (policy.WritesGranted && policy.WritesEnabled) set.Add("mcp.write.use");
                }
            }
            _requestPermissions[userId] = set;
            return set;
        }

        public async Task<bool> HasMcpToolAccessAsync(int userId, string toolName)
        {
            var tool = McpToolAccessCatalog.Find(toolName);
            if (tool == null || !await HasPermissionAsync(userId, "mcp.access.use")) return false;
            if (tool.SeedOnly && !IsSeedAdmin(userId)) return false;
            if (tool.Write && !await HasPermissionAsync(userId, "mcp.write.use")) return false;
            if (tool.Permissions.Length > 0)
            {
                var eligible = false;
                foreach (var key in tool.Permissions)
                {
                    var granted = await HasPermissionAsync(userId, key);
                    if (tool.RequireAll && !granted) return false;
                    if (granted) { eligible = true; if (!tool.RequireAll) break; }
                }
                if (!eligible) return false;
            }
            if (!tool.Configurable && tool.GrantedWith == null) return true;
            var policyName = tool.GrantedWith ?? toolName;
            var policy = await McpPolicyAsync(userId);
            return policy == null || (McpUserAccessService.Names(policy.GrantedTools).Contains(policyName)
                && (policy.SelectedTools == null || McpUserAccessService.Names(policy.SelectedTools).Contains(policyName)));
        }

        /// <summary>The keys the user's roles carry (cached across requests for a short TTL).</summary>
        private async Task<HashSet<string>> RolePermissionsAsync(int userId)
        {

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
            _requestPermissions.Remove(userId);
            _requestMcpPolicies.Remove(userId);
            // Current-generation key is removed; older-generation keys expire naturally.
            if (_cache.TryGetValue<long>(GenerationKey, out var gen))
            {
                _cache.Remove($"{CachePrefix}{userId}:g{gen}");
            }
        }

        public void InvalidateAll()
        {
            _requestPermissions.Clear();
            _requestMcpPolicies.Clear();
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
