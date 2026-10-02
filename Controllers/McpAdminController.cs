using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
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
/// Seed-admin management of MCP agent tokens and the activity feed. The secret of a
/// new token is returned once, in the create response, and never stored or shown
/// again (only its hash is kept). The activity feed is read-only: there is
/// deliberately no endpoint that edits or removes a row.
/// </summary>
[ApiController]
[Authorize]
[Route("api/mcp-admin")]
public class McpAdminController(
    AppDbContext db, IPermissionService permissions, ICompanyAccessGuard access, ILogger<McpAdminController> logger)
    : ControllerBase
{
    private int CurrentUserId =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    // Defence in depth: the key alone is not enough, this is the primary admin's console.
    private bool IsSeedAdmin => permissions.IsSeedAdmin(CurrentUserId);

    public sealed class CreateTokenRequest
    {
        public int UserId { get; set; }
        public string Name { get; set; } = "";
        public List<int> CompanyIds { get; set; } = new();
        public List<string> Scopes { get; set; } = new() { "read" };
        public int ExpiresInDays { get; set; } = 30;
    }

    [HttpGet("tokens")]
    [HasPermission("mcp.admin.manage")]
    public async Task<IActionResult> Tokens()
    {
        if (!IsSeedAdmin) return Forbid();
        var now = DateTime.UtcNow;
        var rows = await db.McpAgentTokens.AsNoTracking().Include(t => t.User)
            .OrderByDescending(t => t.CreatedAt).Take(500).ToListAsync();
        var names = await db.Companies.AsNoTracking().Select(c => new { c.Id, c.Name }).ToDictionaryAsync(c => c.Id, c => c.Name);
        Response.Headers.CacheControl = "no-store";
        return Ok(rows.Select(t => new
        {
            t.Id, t.Name, t.Hint, t.UserId, username = t.User?.Username, fullName = t.User?.FullName,
            companies = t.CompanyIdList().Select(id => new { id, name = names.GetValueOrDefault(id, "(deleted)") }),
            scopes = t.Scopes.Split(',', StringSplitOptions.RemoveEmptyEntries), t.AllowWrites,
            t.CreatedAt, t.ExpiresAt, t.LastUsedAt, t.RevokedAt,
            status = t.RevokedAt != null ? "Revoked" : t.ExpiresAt <= now ? "Expired" : "Active",
        }));
    }

    [HttpPost("tokens")]
    [HasPermission("mcp.admin.manage")]
    public async Task<IActionResult> Create([FromBody] CreateTokenRequest req)
    {
        if (!IsSeedAdmin) return Forbid();
        var name = (req.Name ?? "").Trim();
        if (name.Length is < 1 or > 100) return BadRequest(new { message = "Give the token a name of 1 to 100 characters." });
        if (req.ExpiresInDays < 1 || req.ExpiresInDays > McpAgentToken.MaxLifetimeDays)
            return BadRequest(new { message = $"Lifetime must be 1 to {McpAgentToken.MaxLifetimeDays} days." });

        // Read-only until the write phases ship: refusing here means a token can never be
        // pre-granted an authority that no tool yet checks.
        var scopes = (req.Scopes ?? new()).Select(s => s.Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (scopes.Count == 0 || scopes.Any(s => s != "read"))
            return BadRequest(new { message = "Only the read scope is available." });

        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == req.UserId);
        if (user == null) return BadRequest(new { message = "User not found." });
        if (permissions.IsSeedAdmin(user.Id))
            return BadRequest(new { message = "Never connect the primary admin to an agent. Create a dedicated user." });
        if (!await permissions.HasPermissionAsync(user.Id, "mcp.access.use"))
            return BadRequest(new { message = "That user does not hold MCP Access. Assign the MCP Access role first." });

        var companyIds = (req.CompanyIds ?? new()).Distinct().ToList();
        if (companyIds.Count is < 1 or > 50) return BadRequest(new { message = "Choose between 1 and 50 companies." });
        var reachable = await access.GetAccessibleCompanyIdsAsync(user.Id);
        if (companyIds.Any(id => !reachable.Contains(id)))
            return BadRequest(new { message = "A token can only name companies its user can reach." });

        var secret = McpAgentAuthHandler.NewSecret();
        var now = DateTime.UtcNow;
        var token = new McpAgentToken
        {
            UserId = user.Id, Name = name, TokenHash = McpAgentAuthHandler.Hash(secret), Hint = secret.Substring(0, McpAgentToken.Prefix.Length + 4),
            CompanyIds = string.Join(',', companyIds), Scopes = string.Join(',', scopes), AllowWrites = false,
            CreatedAt = now, CreatedByUserId = CurrentUserId, ExpiresAt = now.AddDays(req.ExpiresInDays),
        };
        db.McpAgentTokens.Add(token);
        await db.SaveChangesAsync();
        logger.LogInformation("Seed admin {AdminId} created MCP agent token {TokenId} for user {UserId}", CurrentUserId, token.Id, user.Id);
        Response.Headers.CacheControl = "no-store";
        return Ok(new { token.Id, token.Name, token.Hint, secret, token.ExpiresAt });
    }

    [HttpPost("tokens/{id:int}/revoke")]
    [HasPermission("mcp.admin.manage")]
    public async Task<IActionResult> Revoke(int id)
    {
        if (!IsSeedAdmin) return Forbid();
        var now = DateTime.UtcNow;
        var count = await db.McpAgentTokens.Where(t => t.Id == id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.RevokedByUserId, CurrentUserId));
        if (count == 0) return NotFound();
        logger.LogInformation("Seed admin {AdminId} revoked MCP agent token {TokenId}", CurrentUserId, id);
        return Ok(new { message = "Agent token revoked." });
    }

    [HttpGet("activity")]
    [HasPermission("mcp.admin.manage")]
    public async Task<IActionResult> Activity(int page = 1, int pageSize = 50, int? tokenId = null, int? userId = null,
        int? companyId = null, string? tool = null, string? outcome = null, DateTime? from = null, DateTime? to = null)
    {
        if (!IsSeedAdmin) return Forbid();
        if (outcome is not (null or "" or "ok" or "denied" or "error")) return BadRequest(new { message = "Invalid outcome." });
        var q = db.McpActivities.AsNoTracking().AsQueryable();
        if (tokenId.HasValue) q = q.Where(a => a.AgentTokenId == tokenId);
        if (userId.HasValue) q = q.Where(a => a.UserId == userId);
        if (companyId.HasValue) q = q.Where(a => a.CompanyId == companyId);
        if (!string.IsNullOrWhiteSpace(tool)) { var t = tool.Trim(); q = q.Where(a => a.Tool == t); }
        if (!string.IsNullOrEmpty(outcome)) q = q.Where(a => a.Outcome == outcome);
        if (from.HasValue) q = q.Where(a => a.At >= from);
        if (to.HasValue) q = q.Where(a => a.At <= to);
        page = PaginationHelper.ClampPage(page);
        pageSize = PaginationHelper.Clamp(pageSize, 50);
        var total = await q.CountAsync();
        var items = await q.OrderByDescending(a => a.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { items, total, page, pageSize });
    }
}
