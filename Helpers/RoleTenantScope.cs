using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers;

public static class RoleTenantScope
{
    public static async Task<int?> ResolveAsync(AppDbContext db, IManagementScopeService scope, int userId)
    {
        if (userId <= 0 || !await db.Users.AnyAsync(u => u.Id == userId)) return null;
        if (scope.IsSeedAdmin(userId)) return userId;
        var ancestors = await scope.GetAncestorUserIdsAsync(userId);
        var root = ancestors.LastOrDefault(userId);
        var parent = await db.Users.Where(u => u.Id == root).Select(u => u.CreatedByUserId).SingleAsync();
        return parent == null || scope.IsSeedAdmin(parent.Value) ? root : null;
    }
}
