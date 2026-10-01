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

        private readonly AppDbContext _context;
        private readonly int _seedAdminUserId;

        public PermissionService(AppDbContext context, IMemoryCache cache, IConfiguration configuration)
        {
            _context = context;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public bool IsSeedAdmin(int userId) => userId > 0 && userId == _seedAdminUserId;

        public async Task<bool> HasPermissionAsync(int userId, string permissionKey)
        {
            if (IsSeedAdmin(userId)) return true;
            var perms = await GetUserPermissionsAsync(userId);
            return perms.Contains(permissionKey);
        }

        public async Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId)
        {
            if (userId <= 0) return Array.Empty<string>();
            if (IsSeedAdmin(userId))
            {
                // Seed admin implicitly has every catalog key — no DB hit needed.
                return PermissionCatalog.All.Select(p => p.Key).ToHashSet(StringComparer.OrdinalIgnoreCase);
            }

            if (_requestPermissions.TryGetValue(userId, out var cached))
                return cached;

            var perms = await _context.UserRoles
                .Where(ur => ur.UserId == userId)
                .SelectMany(ur => ur.Role!.RolePermissions)
                .Select(rp => rp.Permission!.Key)
                .Distinct()
                .ToListAsync();

            var set = new HashSet<string>(perms, StringComparer.OrdinalIgnoreCase);
            _requestPermissions[userId] = set;
            return set;
        }

        public void InvalidateUser(int userId) => _requestPermissions.Remove(userId);

        public void InvalidateAll() => _requestPermissions.Clear();
    }
}
