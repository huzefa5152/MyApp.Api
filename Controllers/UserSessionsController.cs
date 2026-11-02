using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;

namespace MyApp.Api.Controllers;

[ApiController]
[Route("api/user-sessions")]
[Authorize]
public class UserSessionsController(AppDbContext db, IConfiguration configuration, ILogger<UserSessionsController> logger) : ControllerBase
{
    private int CurrentUserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;
    private bool IsSeedAdmin => CurrentUserId > 0 && CurrentUserId == configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);

    [HttpGet]
    [HasPermission("users.manage.view")]
    public async Task<IActionResult> List(int page = 1, int pageSize = 25, int? userId = null, string status = "signed-in", string? search = null)
    {
        if (!IsSeedAdmin) return Forbid();
        if (status is not ("signed-in" or "recent" or "expired" or "revoked" or "all")) return BadRequest(new { message = "Invalid session status." });
        var now = DateTime.UtcNow;
        var recent = now.AddMinutes(-5);
        var rows = from s in db.UserSessions.AsNoTracking()
                   join u in db.Users.AsNoTracking() on s.UserId equals u.Id
                   select new { s.Id, s.UserId, u.Username, u.FullName, s.CreatedAt, s.LastSeenAt, s.ExpiresAt, s.TokenExpiresAt, s.RevokedAt,
                       s.UserAgent, s.IpAddress, Revoked = s.IsRevoked || s.SecurityStamp != u.SecurityStamp };
        var signedIn = rows.Where(s => !s.Revoked && s.ExpiresAt > now && s.TokenExpiresAt > now);
        var summary = new {
            totalUsers = await db.Users.CountAsync(),
            signedInUsers = await signedIn.Select(s => s.UserId).Distinct().CountAsync(),
            signedInSessions = await signedIn.CountAsync(),
            recentlyActiveUsers = await signedIn.Where(s => s.LastSeenAt >= recent).Select(s => s.UserId).Distinct().CountAsync(),
            recentlyActiveSessions = await signedIn.CountAsync(s => s.LastSeenAt >= recent)
        };
        if (userId.HasValue) rows = rows.Where(s => s.UserId == userId.Value);
        if (!string.IsNullOrWhiteSpace(search)) {
            search = search.Trim();
            if (search.Length > 100) return BadRequest(new { message = "Search must be at most 100 characters." });
            rows = rows.Where(s => s.Username.Contains(search) || s.FullName.Contains(search));
        }
        rows = status switch {
            "signed-in" => rows.Where(s => !s.Revoked && s.ExpiresAt > now && s.TokenExpiresAt > now),
            "recent" => rows.Where(s => !s.Revoked && s.ExpiresAt > now && s.TokenExpiresAt > now && s.LastSeenAt >= recent),
            "expired" => rows.Where(s => !s.Revoked && (s.ExpiresAt <= now || s.TokenExpiresAt <= now)),
            "revoked" => rows.Where(s => s.Revoked),
            _ => rows
        };
        page = PaginationHelper.ClampPage(page);
        pageSize = PaginationHelper.Clamp(pageSize, 25);
        var total = await rows.CountAsync();
        page = Math.Min(page, Math.Max(1, (int)Math.Ceiling(total / (double)pageSize)));
        var current = User.FindFirstValue("sid");
        var items = await rows.OrderByDescending(s => s.LastSeenAt).ThenBy(s => s.Id)
            .Skip((page - 1) * pageSize).Take(pageSize).Select(s => new {
                s.Id, s.UserId, s.Username, s.FullName, s.CreatedAt, s.LastSeenAt, s.ExpiresAt, s.TokenExpiresAt, s.RevokedAt,
                s.UserAgent, s.IpAddress, isCurrentSession = s.Id == current,
                status = s.Revoked ? "Revoked" : s.ExpiresAt <= now || s.TokenExpiresAt <= now ? "Expired" : s.LastSeenAt >= recent ? "Recently active" : "Signed in"
            }).ToListAsync();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { summary, items, total, page, pageSize, observedAt = now });
    }

    [HttpPost("{id}/revoke")]
    [HasPermission("users.manage.update")]
    public async Task<IActionResult> Revoke(string id)
    {
        if (!IsSeedAdmin) return Forbid();
        var count = await db.UserSessions.Where(s => s.Id == id && !s.IsRevoked)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsRevoked, true).SetProperty(x => x.RevokedAt, DateTime.UtcNow));
        if (count == 0) return NotFound();
        logger.LogInformation("Seed administrator {UserId} revoked a device session", CurrentUserId);
        return Ok(new { message = "Device session signed out." });
    }

    [HttpPost("user/{userId:int}/revoke")]
    [HasPermission("users.manage.update")]
    public async Task<IActionResult> RevokeUser(int userId)
    {
        if (!IsSeedAdmin) return Forbid();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var stamp = Guid.NewGuid().ToString("N");
        var count = await db.Users.Where(u => u.Id == userId).ExecuteUpdateAsync(s => s.SetProperty(u => u.SecurityStamp, stamp));
        if (count == 0) return NotFound();
        await db.UserSessions.Where(s => s.UserId == userId && !s.IsRevoked)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsRevoked, true).SetProperty(x => x.RevokedAt, DateTime.UtcNow));
        // "Signed out everywhere" includes AI agent connections.
        await McpTokenRevocation.RevokeAllForUserAsync(db, userId, CurrentUserId);
        await transaction.CommitAsync();
        logger.LogInformation("Seed administrator {AdminId} revoked all sessions for user {UserId}", CurrentUserId, userId);
        return Ok(new { message = "All sessions for this user signed out." });
    }
}
