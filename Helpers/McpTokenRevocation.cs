using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers;

/// <summary>
/// Ends a user's MCP access when their credentials change. Called when the user's
/// password changes — their own change and an admin's reset — so a token minted by someone
/// who had taken over the account stops working the moment the owner takes it
/// back. On this line a plain logout ALSO rotates the stamp, so tokens are not
/// bound to it (that would end every AI connection at each browser logout);
/// revocation happens explicitly here instead.
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
