using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

/// <summary>
/// Authenticates "Bearer tmcp_..." credentials for POST /mcp. It answers only to
/// that prefix (anything else is somebody else's), and the JWT handler steps aside
/// for the same prefix, so an agent token is accepted on /mcp and nowhere else.
///
/// The row is read on EVERY request, so revoking a token, letting it expire or
/// deleting its user takes effect on the very next call. The loaded row travels
/// in HttpContext.Items so the endpoint enforces its company and scope limits
/// without a second query.
/// </summary>
public sealed class McpAgentAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder, AppDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string Scheme = "McpAgent";
    public const string ItemKey = "mcpAgentToken";

    public static string Hash(string secret) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();

    /// <summary>A fresh secret: 256 random bits, URL-safe, with the recognisable prefix.</summary>
    public static string NewSecret() =>
        McpAgentToken.Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

    public static bool IsAgentHeader(string? authorization) =>
        authorization != null && authorization.StartsWith("Bearer " + McpAgentToken.Prefix, StringComparison.Ordinal);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!IsAgentHeader(header)) return AuthenticateResult.NoResult();

        var secret = header["Bearer ".Length..].Trim();
        if (secret.Length > 128) return AuthenticateResult.Fail("Invalid agent token.");

        var hash = Hash(secret);
        var token = await db.McpAgentTokens.Include(t => t.User).FirstOrDefaultAsync(t => t.TokenHash == hash);
        var now = DateTime.UtcNow;
        if (token?.User == null || token.RevokedAt != null || token.ExpiresAt <= now)
            return AuthenticateResult.Fail("Invalid agent token.");

        // At most one write a minute; the activity log is the real record of use.
        if (token.LastUsedAt == null || token.LastUsedAt < now.AddMinutes(-1))
            await db.McpAgentTokens.Where(t => t.Id == token.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.LastUsedAt, now));

        Context.Items[ItemKey] = token;
        var identity = new ClaimsIdentity(new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, token.UserId.ToString()),
            new Claim(ClaimTypes.NameIdentifier, token.UserId.ToString()),
            new Claim(ClaimTypes.Name, token.User.Username),
            new Claim("mcp_token_id", token.Id.ToString()),
        }, Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme));
    }
}
