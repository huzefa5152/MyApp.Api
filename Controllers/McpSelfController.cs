using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// Self-service MCP for the signed-in user: see whether MCP is enabled for them, create
/// and revoke THEIR OWN agent tokens, and read the log of what their agents did.
///
/// Reachable only with a normal login token (JWT scheme). An agent token must never be
/// able to mint more agent tokens, so it is not accepted here. Every token created here
/// is capped by what its owner already has: only companies they reach, and a scope the
/// platform currently offers.
/// </summary>
[ApiController]
[Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
[Route("api/mcp/me")]
public class McpSelfController(
    AppDbContext db, IPermissionService permissions, ICompanyAccessGuard access, ILogger<McpSelfController> logger)
    : ControllerBase
{
    private const int MaxActiveTokens = 10;

    private int CurrentUserId =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    public sealed class CreateRequest
    {
        public string Name { get; set; } = "";
        public List<int> CompanyIds { get; set; } = new();
        public List<string> Scopes { get; set; } = new() { "read" };
        public int ExpiresInDays { get; set; } = 30;
    }

    // Any signed-in user may ask; the answer says whether MCP is switched on for them and why not.
    [HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var uid = CurrentUserId;
        var isSeed = permissions.IsSeedAdmin(uid);
        var hasAccess = await permissions.HasPermissionAsync(uid, "mcp.access.use");
        var reachable = await access.GetAccessibleCompanyIdsAsync(uid);
        var companies = await db.Companies.AsNoTracking().Where(c => reachable.Contains(c.Id))
            .OrderBy(c => c.Name).Select(c => new { c.Id, c.Name }).ToListAsync();
        var now = DateTime.UtcNow;
        var tokens = await db.McpAgentTokens.AsNoTracking().Where(t => t.UserId == uid)
            .OrderByDescending(t => t.CreatedAt).Take(100).ToListAsync();
        var names = companies.ToDictionary(c => c.Id, c => c.Name);
        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            enabled = hasAccess && !isSeed,
            reason = isSeed ? "seed-admin" : hasAccess ? "" : "not-enabled",
            companies,
            scopesAvailable = await McpScopes.AvailableAsync(permissions, uid),
            maxLifetimeDays = McpAgentToken.MaxLifetimeDays,
            tokens = tokens.Select(t => new
            {
                t.Id, t.Name, t.Hint,
                companies = t.CompanyIdList().Select(id => new { id, name = names.GetValueOrDefault(id, "(no longer reachable)") }),
                scopes = t.Scopes.Split(',', StringSplitOptions.RemoveEmptyEntries),
                t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt,
                status = t.Status(now), signIn = t.OAuthClientId != null,
            }),
        });
    }

    [HttpPost("tokens")]
    [HasPermission("mcp.access.use")]
    public async Task<IActionResult> Create([FromBody] CreateRequest req)
    {
        var uid = CurrentUserId;
        if (permissions.IsSeedAdmin(uid))
            return BadRequest(new { message = "The primary admin cannot connect an agent. Use a dedicated user." });
        var name = (req.Name ?? "").Trim();
        if (name.Length is < 1 or > 100) return BadRequest(new { message = "Give the token a name of 1 to 100 characters." });
        if (req.ExpiresInDays < 1 || req.ExpiresInDays > McpAgentToken.MaxLifetimeDays)
            return BadRequest(new { message = $"Lifetime must be 1 to {McpAgentToken.MaxLifetimeDays} days." });
        var (scopes, scopeError) = await McpScopes.ValidateAsync(permissions, uid, req.Scopes);
        if (scopeError != null) return BadRequest(new { message = scopeError });

        var companyIds = (req.CompanyIds ?? new()).Distinct().ToList();
        if (companyIds.Count is < 1 or > 50) return BadRequest(new { message = "Choose between 1 and 50 companies." });
        var reachable = await access.GetAccessibleCompanyIdsAsync(uid);
        if (companyIds.Any(id => !reachable.Contains(id)))
            return BadRequest(new { message = "You can only choose companies you have access to." });

        var now = DateTime.UtcNow;
        if (await db.McpAgentTokens.CountAsync(t => t.UserId == uid && t.RevokedAt == null && t.ExpiresAt > now) >= MaxActiveTokens)
            return BadRequest(new { message = $"You already have {MaxActiveTokens} active tokens. Revoke one first." });

        var secret = McpAgentAuthHandler.NewSecret();
        var token = new McpAgentToken
        {
            UserId = uid, Name = name, TokenHash = McpAgentAuthHandler.Hash(secret),
            Hint = secret.Substring(0, McpAgentToken.Prefix.Length + 4),
            CompanyIds = string.Join(',', companyIds), Scopes = string.Join(',', scopes), AllowWrites = scopes.Any(McpScopes.IsWrite),
            CreatedAt = now, CreatedByUserId = uid, ExpiresAt = now.AddDays(req.ExpiresInDays),
        };
        db.McpAgentTokens.Add(token);
        await db.SaveChangesAsync();
        logger.LogInformation("User {UserId} created their own MCP agent token {TokenId}", uid, token.Id);
        Response.Headers.CacheControl = "no-store";
        return Ok(new { token.Id, token.Name, token.Hint, secret, token.ExpiresAt });
    }

    [HttpPost("tokens/{id:int}/revoke")]
    [HasPermission("mcp.access.use")]
    public async Task<IActionResult> Revoke(int id)
    {
        var uid = CurrentUserId;
        var now = DateTime.UtcNow;
        // Scoped to the caller: someone else's token id answers 404, like a missing one.
        var count = await db.McpAgentTokens.Where(t => t.Id == id && t.UserId == uid && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.RevokedByUserId, uid));
        if (count == 0) return NotFound();
        logger.LogInformation("User {UserId} revoked their MCP agent token {TokenId}", uid, id);
        return Ok(new { message = "Token revoked." });
    }

    [HttpGet("activity")]
    [HasPermission("mcp.access.use")]
    public async Task<IActionResult> Activity(int page = 1, int pageSize = 25, string? outcome = null)
    {
        if (outcome is not (null or "" or "ok" or "denied" or "error")) return BadRequest(new { message = "Invalid outcome." });
        var uid = CurrentUserId;
        var q = db.McpActivities.AsNoTracking().Where(a => a.UserId == uid);
        if (!string.IsNullOrEmpty(outcome)) q = q.Where(a => a.Outcome == outcome);
        page = PaginationHelper.ClampPage(page);
        pageSize = PaginationHelper.Clamp(pageSize, 25);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(a => a.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { items, total, page, pageSize });
    }
}
