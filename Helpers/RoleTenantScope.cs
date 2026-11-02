using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers;

public static class RoleTenantScope
{
    public static async Task<int?> ResolveAsync(AppDbContext db, IManagementScopeService scope, int userId)
    {
        // Runs on every authorised request. Existence and the root's creator come from the
        // request's user map (one query, shared with the ancestor walk), not two more lookups.
        if (userId <= 0) return null;
        var parents = await scope.GetParentMapAsync();
        if (!parents.ContainsKey(userId)) return null;
        if (scope.IsSeedAdmin(userId)) return userId;
        var ancestors = await scope.GetAncestorUserIdsAsync(userId);
        var root = ancestors.LastOrDefault(userId);
        var parent = parents[root];
        return parent == null || scope.IsSeedAdmin(parent.Value) ? root : null;
    }
}
