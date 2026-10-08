using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class PermissionService : IPermissionService
    {
        // This service is scoped: cache once per request, never across requests.
        private readonly Dictionary<int, HashSet<string>> _requestPermissions = new();
        private readonly Dictionary<int, MyApp.Api.Models.McpUserAccessPolicy?> _requestMcpPolicies = new();

        private async Task<MyApp.Api.Models.McpUserAccessPolicy?> McpPolicyAsync(int userId)
        {
            if (!_requestMcpPolicies.TryGetValue(userId, out var policy))
                _requestMcpPolicies[userId] = policy = await _context.McpUserAccessPolicies.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == userId);
            return policy;
        }

        private readonly AppDbContext _context;
        private readonly int _seedAdminUserId;
        private readonly IManagementScopeService _scope;

        public PermissionService(AppDbContext context, IMemoryCache cache, IConfiguration configuration, IManagementScopeService scope)
        {
            _context = context;
            _scope = scope;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public bool IsSeedAdmin(int userId) => userId > 0 && userId == _seedAdminUserId;

        public async Task<bool> HasPermissionAsync(int userId, string permissionKey)
        {
            if (IsSeedAdmin(userId) && permissionKey is not ("mcp.access.use" or "mcp.write.use")) return true;
            var perms = await GetUserPermissionsAsync(userId);
            return perms.Contains(permissionKey);
        }

        public async Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId)
        {
            if (userId <= 0) return Array.Empty<string>();
            if (_requestPermissions.TryGetValue(userId, out var cached))
                return cached;

            var tenant = IsSeedAdmin(userId) ? null : await RoleTenantScope.ResolveAsync(_context, _scope, userId);
            var perms = IsSeedAdmin(userId) ? PermissionCatalog.All.Select(p => p.Key).ToList() : await _context.UserRoles
                .Where(ur => ur.UserId == userId && (ur.Role!.IsSystemRole ||
                    (tenant != null && ur.Role.TenantAdminUserId == tenant)))
                .SelectMany(ur => ur.Role!.RolePermissions)
                .Select(rp => rp.Permission!.Key)
                .Distinct()
                .ToListAsync();

            var set = new HashSet<string>(perms, StringComparer.OrdinalIgnoreCase);
            var policy = await McpPolicyAsync(userId);
            if (policy != null)
            {
                set.Remove("mcp.access.use");
                set.Remove("mcp.write.use");
                if (policy.AccessGranted && policy.AccessEnabled)
                {
                    set.Add("mcp.access.use");
                    if (policy.WritesGranted && policy.WritesEnabled) set.Add("mcp.write.use");
                }
            }
            _requestPermissions[userId] = set;
            return set;
        }

        public void InvalidateUser(int userId)
        {
            _requestPermissions.Remove(userId);
            _requestMcpPolicies.Remove(userId);
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
            if (!tool.Configurable) return true;
            var policy = await McpPolicyAsync(userId);
            return policy == null || (McpUserAccessService.Names(policy.GrantedTools).Contains(toolName)
                && (policy.SelectedTools == null || McpUserAccessService.Names(policy.SelectedTools).Contains(toolName)));
        }

        public void InvalidateAll()
        {
            _requestPermissions.Clear();
            _requestMcpPolicies.Clear();
        }
    }
}
