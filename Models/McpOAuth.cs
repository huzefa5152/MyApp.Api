namespace MyApp.Api.Models;

/// <summary>
/// An AI application (claude.ai, ChatGPT, Codex...) that registered itself through
/// OAuth dynamic client registration. Public client: it holds no secret and proves
/// possession with PKCE instead. Registration grants nothing by itself: a user must
/// still sign in and approve, and may choose the companies.
/// </summary>
public class McpOAuthClient
{
    public const int MaxClients = 2000;
    /// <summary>Public identifier, "mcpc_..." (not a secret).</summary>
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>Newline-separated redirect URIs; a request must match one exactly.</summary>
    public string RedirectUris { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public IReadOnlyList<string> RedirectUriList() =>
        RedirectUris.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}

/// <summary>
/// A single-use authorization code issued after a user approved a connection. Stored as
/// a hash; lives five minutes; bound to the client, redirect URI and PKCE challenge.
/// </summary>
public class McpOAuthCode
{
    public int Id { get; set; }
    public string CodeHash { get; set; } = "";
    public string ClientId { get; set; } = "";
    public int UserId { get; set; }
    public string RedirectUri { get; set; } = "";
    public string CodeChallenge { get; set; } = "";
    public string CompanyIds { get; set; } = "";
    public string Scopes { get; set; } = "read";
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    /// <summary>Token minted from this code, so a replayed code can revoke it.</summary>
    public int? IssuedTokenId { get; set; }
}
