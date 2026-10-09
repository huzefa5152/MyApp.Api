namespace MyApp.Api.Models;

/// <summary>
/// A credential for one AI agent (Codex, Claude, an automation) acting as ONE
/// user through POST /mcp. Only the SHA-256 of the secret is stored, so the
/// secret exists exactly once, on screen, when the seed admin creates it.
///
/// Effective access is the owning user's access narrowed by this row; the
/// stricter side always wins. Revoking, expiring or deleting the user ends
/// the token on its very next call.
/// </summary>
public class McpAgentToken
{
    public const string Prefix = "tmcp_";
    public const int MaxLifetimeDays = 90;
    /// <summary>Longest a token owned by the primary admin may live: it can reach every tenant.</summary>
    public const int SeedAdminMaxLifetimeDays = 30;
    /// <summary>Stored in CompanyIds for "every company the owner can reach, now and later". Primary admin only.</summary>
    public const string AllCompaniesMarker = "*";

    /// <summary>Scopes an agent may be granted. "read" covers every read-only tool.</summary>
    public static readonly string[] AllScopes =
        { "read", "templates.read", "documents.read", "clients.write", "quotes.write", "challans.write", "bills.write", "email.enquiries.write" };

    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>SHA-256 (hex) of the secret. Never the secret.</summary>
    public string TokenHash { get; set; } = "";
    /// <summary>First characters of the secret, to recognise a token in a list.</summary>
    public string Hint { get; set; } = "";
    /// <summary>Comma-separated company ids. Never empty: a token always names its companies.</summary>
    public string CompanyIds { get; set; } = "";
    /// <summary>Comma-separated scopes from <see cref="AllScopes"/>.</summary>
    public string Scopes { get; set; } = "read";
    /// <summary>Plans may be prepared and committed only when true. Off by default.</summary>
    public bool AllowWrites { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int CreatedByUserId { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? LastUsedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
    public int? RevokedByUserId { get; set; }

    // Sign-in (OAuth) connections: the access secret above is short-lived (an hour) and is
    // renewed with the refresh secret, which is stored as a hash like the access one. The
    // row, and so its history, stays the same across renewals.
    public string? OAuthClientId { get; set; }
    public string? RefreshHash { get; set; }
    public DateTime? RefreshExpiresAt { get; set; }

    /// <summary>
    /// The owner's <see cref="User.SecurityStamp"/> when the token was issued. A
    /// password change, an admin reset and "sign out everywhere" rotate the user's
    /// stamp, and a token whose stamp no longer matches is refused on every call
    /// and on refresh. NULL on rows issued before this column existed; those are
    /// revoked outright by <c>McpTokenRevocation</c> when the stamp rotates.
    /// </summary>
    public string? SecurityStamp { get; set; }

    /// <summary>Hard ceiling on a token's whole life, renewals included.</summary>
    public static int MaxLifetimeFor(bool ownerIsSeedAdmin) =>
        ownerIsSeedAdmin ? SeedAdminMaxLifetimeDays : MaxLifetimeDays;

    /// <summary>"Active" while the access secret is live, or an OAuth connection can still renew.</summary>
    public string Status(DateTime now) =>
        RevokedAt != null ? "Revoked"
        : ExpiresAt > now || (OAuthClientId != null && RefreshExpiresAt > now) ? "Active"
        : "Expired";

    public User? User { get; set; }

    public bool AllCompanies => CompanyIds == AllCompaniesMarker;

    public IReadOnlyList<int> CompanyIdList() =>
        CompanyIds.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => int.TryParse(s, out var id) ? id : 0).Where(id => id > 0).ToList();

    public bool HasScope(string scope) =>
        Scopes.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Contains(scope, StringComparer.Ordinal);
}
