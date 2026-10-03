using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

[ApiController]
[Route("api/mcp/catalog")]
[Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
public sealed class McpCatalogController(AppDbContext db, IPermissionService permissions,
    IManagementScopeService management, McpUserAccessService catalog, ILogger<McpCatalogController> logger) : ControllerBase
{
    private int Actor => int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ??
        User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : 0;

    public sealed class SaveRequest
    {
        public Guid Revision { get; set; }
        public bool AccessGranted { get; set; }
        public bool WritesGranted { get; set; }
        public bool AccessEnabled { get; set; }
        public bool WritesEnabled { get; set; }
        public List<string> GrantedTools { get; set; } = [];
        public List<string> SelectedTools { get; set; } = [];
    }

    private async Task<bool> CanManageAsync(int uid) => management.IsSeedAdmin(Actor) ||
        (uid != Actor && await permissions.HasPermissionAsync(Actor, "users.manage.update") &&
            await permissions.HasPermissionAsync(Actor, "rbac.userroles.assign") && await management.CanManageUserAsync(Actor, uid));

    private async Task<bool> CanReadAsync(int uid) => uid == Actor || (await permissions.HasPermissionAsync(Actor,
        "users.manage.view") && await management.CanManageUserAsync(Actor, uid));

    // Normal signed-in users can read and narrow their own access even when MCP is disabled.
    [HttpGet("{userId:int}")]
    public async Task<IActionResult> Get(int userId)
    {
        if (!await CanReadAsync(userId)) return NotFound(new { message = "User not found." });
        var user = await db.Users.AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
        if (user == null) return NotFound(new { message = "User not found." });
        var settings = await catalog.SettingsAsync(userId);
        var policy = await catalog.PolicyAsync(userId);
        var manage = await CanManageAsync(userId);
        var tools = new List<object>();
        foreach (var tool in McpToolAccessCatalog.All)
            tools.Add(new
            {
                tool.Name, tool.Group, tool.Label, tool.Scope, tool.Write, tool.Configurable,
                eligible = await catalog.EligibleAsync(userId, tool),
                grantable = manage && (management.IsSeedAdmin(Actor) || await catalog.AllowedAsync(Actor, tool.Name)),
                granted = !tool.Configurable || settings.Grants.Contains(tool.Name),
                selected = !tool.Configurable || settings.Selection.Contains(tool.Name),
                effective = await catalog.AllowedAsync(userId, tool.Name)
            });
        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            userId, user.Username, user.FullName, canManageGrants = manage, isSelf = userId == Actor,
            revision = settings.Revision, accessGranted = settings.Access, writesGranted = settings.Writes,
            accessEnabled = policy?.AccessEnabled ?? true, writesEnabled = policy?.WritesEnabled ?? true,
            canGrantAccess = manage && (management.IsSeedAdmin(Actor) || await permissions.HasPermissionAsync(Actor, "mcp.access.use")),
            canGrantWrites = manage && (management.IsSeedAdmin(Actor) || await permissions.HasPermissionAsync(Actor, "mcp.write.use")),
            tools, legacy = policy == null
        });
    }

    // Manual guards are deliberate: self-service only narrows grants; managers require both
    // user update and assignment authority, bounded by the existing management hierarchy.
    [HttpPut("{userId:int}")]
    public async Task<IActionResult> Save(int userId, [FromBody] SaveRequest request)
    {
        if (!await CanReadAsync(userId)) return NotFound(new { message = "User not found." });
        var manage = await CanManageAsync(userId);
        if (userId != Actor && !manage) return Forbid();
        if (!await db.Users.AnyAsync(u => u.Id == userId)) return NotFound(new { message = "User not found." });
        if (request.GrantedTools == null || request.SelectedTools == null ||
            request.GrantedTools.Count > 100 || request.SelectedTools.Count > 100)
            return BadRequest(new { message = "Choose valid catalog entries." });
        var grants = request.GrantedTools.ToHashSet(StringComparer.Ordinal);
        var selected = request.SelectedTools.ToHashSet(StringComparer.Ordinal);
        if (grants.Concat(selected).Any(n => n == null || McpToolAccessCatalog.Find(n) is not { Configurable: true }))
            return BadRequest(new { message = "Choose valid catalog entries." });
        if (!selected.IsSubsetOf(grants)) return BadRequest(new { message = "Selected tools must be allowed for this user." });
        if (request.WritesGranted && !request.AccessGranted)
            return BadRequest(new { message = "Enable MCP access before allowing changes." });
        var old = await catalog.SettingsAsync(userId);
        if (request.Revision != old.Revision)
            return Conflict(new { message = "These settings changed. Reload before saving." });
        if (!manage)
        {
            if (request.AccessGranted != old.Access || request.WritesGranted != old.Writes || !grants.SetEquals(old.Grants))
                return Forbid();
        }
        else if (!management.IsSeedAdmin(Actor))
        {
            if ((!old.Access && request.AccessGranted && !await permissions.HasPermissionAsync(Actor, "mcp.access.use")) ||
                (!old.Writes && request.WritesGranted && !await permissions.HasPermissionAsync(Actor, "mcp.write.use"))) return Forbid();
            foreach (var name in grants.Except(old.Grants))
                if (!await catalog.AllowedAsync(Actor, name) || !await catalog.EligibleAsync(userId, McpToolAccessCatalog.Find(name)!))
                    return Forbid();
        }
        // A manager may preserve dormant grants but may not activate them through preferences
        // after losing their own authority. Self preferences are bounded by existing grants.
        if (manage && userId != Actor && !management.IsSeedAdmin(Actor))
        {
            foreach (var name in selected.Except(old.Selection))
                if (!await catalog.AllowedAsync(Actor, name)) return Forbid();
            var oldPolicy = await catalog.PolicyAsync(userId);
            foreach (var name in selected)
            {
                var tool = McpToolAccessCatalog.Find(name)!;
                var activated = request.AccessGranted && request.AccessEnabled &&
                    (!tool.Write || (request.WritesGranted && request.WritesEnabled));
                var wasActive = old.Access && (oldPolicy?.AccessEnabled ?? true) && old.Selection.Contains(name) &&
                    (!tool.Write || (old.Writes && (oldPolicy?.WritesEnabled ?? true)));
                if (activated && !wasActive && !await catalog.AllowedAsync(Actor, name)) return Forbid();
            }
        }
        var row = await db.McpUserAccessPolicies.SingleOrDefaultAsync(p => p.UserId == userId);
        if (row == null)
        {
            row = new McpUserAccessPolicy { UserId = userId };
            db.McpUserAccessPolicies.Add(row);
        }
        else if (row.Revision != request.Revision)
            return Conflict(new { message = "These settings changed. Reload before saving." });
        row.AccessGranted = request.AccessGranted;
        row.WritesGranted = request.WritesGranted;
        row.GrantedTools = JsonSerializer.Serialize(grants.Order(StringComparer.Ordinal));
        row.AccessEnabled = request.AccessEnabled;
        row.WritesEnabled = request.WritesEnabled;
        row.SelectedTools = JsonSerializer.Serialize(selected.Order(StringComparer.Ordinal));
        row.Revision = Guid.NewGuid();
        row.UpdatedAt = DateTime.UtcNow;
        row.UpdatedByUserId = Actor;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Conflict(new { message = "These settings changed. Reload before saving." }); }
        catch (DbUpdateException) when (old.Revision == Guid.Empty)
        { return Conflict(new { message = "These settings changed. Reload before saving." }); }
        catalog.Invalidate(userId);
        permissions.InvalidateUser(userId);
        logger.LogInformation("User {ActorId} updated MCP catalog for user {TargetId}, revision {Revision}", Actor, userId, row.Revision);
        return await Get(userId);
    }
}
