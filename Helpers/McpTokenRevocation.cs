using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers;

/// <summary>
/// Ends a user's MCP access when their credentials change. Called wherever the
/// user's SecurityStamp is rotated — their own password change, an admin's
/// password reset, and "sign out everywhere" — so a token minted by someone
/// who had taken over the account stops working the moment the owner takes it
/// back. Tokens issued since 2026-10-09 also carry the stamp and are refused by
/// McpAgentAuthHandler on mismatch; this revokes the older rows that do not.
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
