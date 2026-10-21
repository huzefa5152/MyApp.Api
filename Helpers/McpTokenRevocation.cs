using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers;

/// <summary>
/// Ends a user's MCP access when their credentials change: their own password change and an
/// admin's password reset. A token minted by someone who had taken over the account stops
/// working the moment the owner takes it back. (An ordinary sign-out does not end agents.)
/// </summary>
public static class McpTokenRevocation
{
    public static Task<int> RevokeAllForUserAsync(AppDbContext db, int userId, int? revokedByUserId)
    {
        var now = DateTime.UtcNow;
        return db.McpAgentTokens.Where(t => t.UserId == userId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now).SetProperty(t => t.RevokedByUserId, revokedByUserId));
    }
}
