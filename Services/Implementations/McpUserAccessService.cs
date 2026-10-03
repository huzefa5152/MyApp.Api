using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations;

// Request-scoped: changing a profile takes effect on the very next MCP request.
public sealed class McpUserAccessService(AppDbContext db, IPermissionService permissions)
{
    private readonly Dictionary<int, McpUserAccessPolicy?> rows = new();

    public async Task<McpUserAccessPolicy?> PolicyAsync(int uid)
    {
        if (!rows.TryGetValue(uid, out var row))
            rows[uid] = row = await db.McpUserAccessPolicies.AsNoTracking().SingleOrDefaultAsync(p => p.UserId == uid);
        return row;
    }

    public static HashSet<string> Names(string? json) => json == null ? new(StringComparer.Ordinal) :
        (JsonSerializer.Deserialize<string[]>(json) ?? []).ToHashSet(StringComparer.Ordinal);

    public async Task<bool> EligibleAsync(int uid, McpToolAccessDefinition tool)
    {
        if (tool.SeedOnly && !permissions.IsSeedAdmin(uid)) return false;
        if (tool.Permissions.Length == 0) return true;
        foreach (var key in tool.Permissions)
            if (await permissions.HasPermissionAsync(uid, key)) return true;
        return false;
    }

    public async Task<bool> AllowedAsync(int uid, string name)
    {
        return await permissions.HasMcpToolAccessAsync(uid, name);
    }

    public async Task<(bool Access, bool Writes, HashSet<string> Grants, HashSet<string> Selection, Guid Revision)> SettingsAsync(int uid)
    {
        var row = await PolicyAsync(uid);
        if (row != null) return (row.AccessGranted, row.WritesGranted, Names(row.GrantedTools),
            row.SelectedTools == null ? Names(row.GrantedTools) : Names(row.SelectedTools), row.Revision);
        var enabled = await permissions.HasPermissionAsync(uid, "mcp.access.use");
        var writes = await permissions.HasPermissionAsync(uid, "mcp.write.use");
        var grants = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tool in McpToolAccessCatalog.All.Where(t => t.Configurable))
            if (enabled && (!tool.Write || writes) && await EligibleAsync(uid, tool)) grants.Add(tool.Name);
        return (enabled, writes, grants, new(grants, StringComparer.Ordinal), Guid.Empty);
    }

    public void Invalidate(int uid) => rows.Remove(uid);
}
