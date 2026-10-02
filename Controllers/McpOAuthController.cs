using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

/// <summary>
/// "Sign in to connect": OAuth 2.1 authorization-code flow with PKCE (S256 only) and
/// dynamic client registration, as the MCP authorization spec asks of a server that AI
/// products such as claude.ai, ChatGPT or Codex connect to.
///
/// The user is authenticated by the ERP's own login (the app's /connect screen), picks the
/// companies, and approves. The result is an ordinary MCP agent token tied to that user,
/// short-lived and renewed with a rotating refresh secret, so it obeys every limit a pasted
/// token does: the user's own access narrowed by the chosen companies, read-only today, every
/// call logged. Nothing here widens what a user could do by hand.
/// </summary>
[ApiController]
public class McpOAuthController(
    AppDbContext db, IPermissionService permissions, ICompanyAccessGuard access, ILogger<McpOAuthController> logger)
    : ControllerBase
{
    private const int AccessMinutes = 60;
    private const int RefreshDays = 30;
    private const int CodeMinutes = 5;
    private static readonly string[] Scopes = McpScopes.Implemented;

    private int CurrentUserId =>
        int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

    // ── discovery ──────────────────────────────────────────────────────

    [HttpGet("/.well-known/oauth-protected-resource")]
    [HttpGet("/.well-known/oauth-protected-resource/mcp")]
    [AllowAnonymous]
    public IActionResult ProtectedResource()
    {
        var b = McpPublicUrl.Base(HttpContext);
        return Ok(new { resource = b + "/mcp", authorization_servers = new[] { b }, bearer_methods_supported = new[] { "header" }, scopes_supported = Scopes });
    }

    [HttpGet("/.well-known/oauth-authorization-server")]
    [AllowAnonymous]
    public IActionResult AuthorizationServer()
    {
        var b = McpPublicUrl.Base(HttpContext);
        return Ok(new
        {
            issuer = b,
            authorization_endpoint = b + "/oauth/authorize",
            token_endpoint = b + "/oauth/token",
            registration_endpoint = b + "/oauth/register",
            response_types_supported = new[] { "code" },
            grant_types_supported = new[] { "authorization_code", "refresh_token" },
            code_challenge_methods_supported = new[] { "S256" },
            token_endpoint_auth_methods_supported = new[] { "none" },
            scopes_supported = Scopes,
        });
    }

    // ── dynamic client registration (RFC 7591) ─────────────────────────

    [HttpPost("/oauth/register")]
    [AllowAnonymous]
    [EnableRateLimiting("oauth")]
    public async Task<IActionResult> Register([FromBody] JsonElement body)
    {
        if (body.ValueKind != JsonValueKind.Object) return OAuthError("invalid_client_metadata", "Send a JSON object.");
        var name = body.TryGetProperty("client_name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString()!.Trim() : "";
        if (name.Length == 0) name = "AI application";
        if (name.Length > 100) name = name[..100];

        var uris = new List<string>();
        if (body.TryGetProperty("redirect_uris", out var ru) && ru.ValueKind == JsonValueKind.Array)
            foreach (var u in ru.EnumerateArray())
                if (u.ValueKind == JsonValueKind.String) uris.Add(u.GetString()!.Trim());
        if (uris.Count is < 1 or > 10) return OAuthError("invalid_redirect_uri", "Provide 1 to 10 redirect URIs.");
        if (uris.Any(u => !IsAcceptableRedirect(u))) return OAuthError("invalid_redirect_uri", "Redirect URIs must be https, or http on localhost.");
        if (string.Join('\n', uris).Length > 1900) return OAuthError("invalid_redirect_uri", "Redirect URIs are too long.");
        if (await db.McpOAuthClients.CountAsync() >= McpOAuthClient.MaxClients)
            return OAuthError("temporarily_unavailable", "Registration is full. Ask the administrator.", 503);

        var client = new McpOAuthClient { Id = "mcpc_" + B64Url(RandomNumberGenerator.GetBytes(16)), Name = name, RedirectUris = string.Join('\n', uris) };
        db.McpOAuthClients.Add(client);
        await db.SaveChangesAsync();
        NoStore();
        return StatusCode(201, new
        {
            client_id = client.Id, client_name = client.Name, redirect_uris = uris,
            token_endpoint_auth_method = "none", grant_types = new[] { "authorization_code", "refresh_token" },
            response_types = new[] { "code" }, client_id_issued_at = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        });
    }

    /// <summary>https anywhere, or http only to a loopback host (a native app's local callback). No fragments, no credentials.</summary>
    private static bool IsAcceptableRedirect(string value)
    {
        if (value.Length > 400 || !Uri.TryCreate(value, UriKind.Absolute, out var u)) return false;
        if (u.Fragment.Length > 0 || u.UserInfo.Length > 0) return false;
        if (u.Scheme == Uri.UriSchemeHttps) return true;
        return u.Scheme == Uri.UriSchemeHttp && (u.Host is "localhost" or "127.0.0.1" or "[::1]" or "::1");
    }

    // ── authorization ──────────────────────────────────────────────────

    /// <summary>
    /// Entry point the AI client sends the user's browser to. It validates the application
    /// and redirect address, then hands over to the app's sign-in and consent screen. A bad
    /// client or redirect never redirects anywhere: it answers with an error page instead.
    /// </summary>
    [HttpGet("/oauth/authorize")]
    [AllowAnonymous]
    [EnableRateLimiting("oauth")]
    public async Task<IActionResult> Authorize()
    {
        var q = Request.Query;
        var client = await FindClientAsync(q["client_id"]);
        var redirect = q["redirect_uri"].ToString();
        if (client == null || !client.RedirectUriList().Contains(redirect, StringComparer.Ordinal))
            return BadRequest("This application or its redirect address is not recognised.");
        var problem = ValidateAuthRequest(q["response_type"], q["code_challenge"], q["code_challenge_method"]);
        if (problem != null) return Redirect(ErrorRedirect(redirect, problem, q["state"]));
        return LocalRedirect("/admin/connect" + Request.QueryString);
    }

    public sealed class AuthorizeRequest
    {
        public string ClientId { get; set; } = "";
        public string RedirectUri { get; set; } = "";
        public string? State { get; set; }
        public string CodeChallenge { get; set; } = "";
        public string CodeChallengeMethod { get; set; } = "";
        public List<int> CompanyIds { get; set; } = new();
        public List<string> Scopes { get; set; } = new() { "read" };
        /// <summary>Primary admin only: every company, including ones added later.</summary>
        public bool AllCompanies { get; set; }
    }

    /// <summary>What the consent screen needs: who is asking, and whether this user may approve.</summary>
    [HttpGet("/api/oauth/authorize-info")]
    [Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
    public async Task<IActionResult> Info(string? client_id, string? redirect_uri)
    {
        var client = await FindClientAsync(client_id);
        if (client == null || !client.RedirectUriList().Contains(redirect_uri ?? "", StringComparer.Ordinal))
            return NotFound(new { message = "This application or its redirect address is not recognised." });
        var uid = CurrentUserId;
        var isSeed = permissions.IsSeedAdmin(uid);
        var enabled = await permissions.HasPermissionAsync(uid, "mcp.access.use");
        var reachable = await access.GetAccessibleCompanyIdsAsync(uid);
        var companies = await db.Companies.AsNoTracking().Where(c => reachable.Contains(c.Id)).OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name }).ToListAsync();
        NoStore();
        return Ok(new
        {
            clientName = client.Name, redirectHost = new Uri(redirect_uri!).Authority,
            enabled, reason = enabled ? "" : "not-enabled", canUseAllCompanies = isSeed, companies,
            scopes = enabled ? await McpScopes.AvailableAsync(permissions, uid) : new List<string>(),
        });
    }

    [HttpPost("/api/oauth/authorize")]
    [Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
    [HasPermission("mcp.access.use")]
    public async Task<IActionResult> Approve([FromBody] AuthorizeRequest req)
    {
        var uid = CurrentUserId;
        var client = await FindClientAsync(req.ClientId);
        if (client == null || !client.RedirectUriList().Contains(req.RedirectUri ?? "", StringComparer.Ordinal))
            return BadRequest(new { message = "This application or its redirect address is not recognised." });
        if (ValidateAuthRequest("code", req.CodeChallenge, req.CodeChallengeMethod) != null)
            return BadRequest(new { message = "The connection request is malformed. Start again from your AI application." });

        var (companyValue, companyError) = McpScopes.ResolveCompanies(req.AllCompanies, req.CompanyIds, permissions.IsSeedAdmin(uid), await access.GetAccessibleCompanyIdsAsync(uid));
        if (companyError != null) return BadRequest(new { message = companyError });

        var (granted, scopeError) = await McpScopes.ValidateAsync(permissions, uid, req.Scopes);
        if (scopeError != null) return BadRequest(new { message = scopeError });

        var code = B64Url(RandomNumberGenerator.GetBytes(32));
        db.McpOAuthCodes.Add(new McpOAuthCode
        {
            CodeHash = McpAgentAuthHandler.Hash(code), ClientId = client.Id, UserId = uid, RedirectUri = req.RedirectUri!,
            CodeChallenge = req.CodeChallenge, CompanyIds = companyValue!, Scopes = string.Join(',', granted),
            ExpiresAt = DateTime.UtcNow.AddMinutes(CodeMinutes),
        });
        // Housekeeping: spent and expired codes carry no value.
        await db.McpOAuthCodes.Where(c => c.ExpiresAt < DateTime.UtcNow.AddHours(-1)).ExecuteDeleteAsync();
        await db.SaveChangesAsync();
        logger.LogInformation("User {UserId} approved MCP connection for client {ClientId}", uid, client.Id);
        NoStore();
        return Ok(new { redirectUrl = AppendQuery(req.RedirectUri!, ("code", code), ("state", req.State)) });
    }

    [HttpPost("/api/oauth/deny")]
    [Authorize(AuthenticationSchemes = JwtBearerDefaults.AuthenticationScheme)]
    public async Task<IActionResult> Deny([FromBody] AuthorizeRequest req)
    {
        var client = await FindClientAsync(req.ClientId);
        if (client == null || !client.RedirectUriList().Contains(req.RedirectUri ?? "", StringComparer.Ordinal))
            return BadRequest(new { message = "This application or its redirect address is not recognised." });
        return Ok(new { redirectUrl = ErrorRedirect(req.RedirectUri!, "access_denied", req.State) });
    }

    // ── token endpoint ─────────────────────────────────────────────────

    [HttpPost("/oauth/token")]
    [AllowAnonymous]
    [EnableRateLimiting("oauth")]
    public async Task<IActionResult> Token()
    {
        NoStore();
        if (Request.ContentLength > 8192) return OAuthError("invalid_request", "Request too large.");
        if (!Request.HasFormContentType) return OAuthError("invalid_request", "Send application/x-www-form-urlencoded.");
        var f = await Request.ReadFormAsync();
        return f["grant_type"].ToString() switch
        {
            "authorization_code" => await ExchangeCodeAsync(f),
            "refresh_token" => await RefreshAsync(f),
            _ => OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token."),
        };
    }

    private async Task<IActionResult> ExchangeCodeAsync(IFormCollection f)
    {
        string clientId = f["client_id"].ToString(), code = f["code"].ToString(), verifier = f["code_verifier"].ToString(), redirect = f["redirect_uri"].ToString();
        if (clientId.Length == 0 || code.Length == 0 || redirect.Length == 0 || verifier.Length is < 43 or > 128)
            return OAuthError("invalid_request", "client_id, code, redirect_uri and a PKCE code_verifier are required.");

        var now = DateTime.UtcNow;
        var hash = McpAgentAuthHandler.Hash(code);
        var row = await db.McpOAuthCodes.FirstOrDefaultAsync(c => c.CodeHash == hash);
        if (row == null) return OAuthError("invalid_grant", "The authorization code is not valid.");
        if (row.UsedAt != null)
        {
            // A code is single-use. Seeing it again means it leaked: end what it produced.
            if (row.IssuedTokenId is int issued)
                await db.McpAgentTokens.Where(t => t.Id == issued && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));
            return OAuthError("invalid_grant", "The authorization code was already used.");
        }
        if (row.ExpiresAt <= now || row.ClientId != clientId || row.RedirectUri != redirect)
            return OAuthError("invalid_grant", "The authorization code is not valid.");
        var computed = B64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(computed), Encoding.ASCII.GetBytes(row.CodeChallenge)))
            return OAuthError("invalid_grant", "PKCE verification failed.");

        // Claim it atomically: of two simultaneous exchanges only one wins.
        var claimed = await db.McpOAuthCodes.Where(c => c.Id == row.Id && c.UsedAt == null).ExecuteUpdateAsync(s => s.SetProperty(c => c.UsedAt, now));
        if (claimed == 0) return OAuthError("invalid_grant", "The authorization code was already used.");

        var client = await FindClientAsync(clientId);
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == row.UserId);
        if (client == null || user == null || !await permissions.HasPermissionAsync(user.Id, "mcp.access.use"))
            return OAuthError("invalid_grant", "MCP access is no longer enabled for this user.");
        string companyValue;
        if (row.CompanyIds == McpAgentToken.AllCompaniesMarker && permissions.IsSeedAdmin(user.Id))
            companyValue = McpAgentToken.AllCompaniesMarker;
        else
        {
            var reachable = await access.GetAccessibleCompanyIdsAsync(user.Id);
            var companies = row.CompanyIds.Split(',', StringSplitOptions.RemoveEmptyEntries).Where(c => int.TryParse(c, out _)).Select(int.Parse).Where(reachable.Contains).ToList();
            if (companies.Count == 0) return OAuthError("invalid_grant", "None of the approved companies is reachable any more.");
            companyValue = string.Join(',', companies);
        }

        // One live connection per user and application: signing in again replaces the old one.
        await db.McpAgentTokens.Where(t => t.UserId == user.Id && t.OAuthClientId == clientId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));

        var access1 = McpAgentAuthHandler.NewSecret();
        var refresh = NewRefreshSecret();
        var token = new McpAgentToken
        {
            UserId = user.Id, Name = $"{client.Name} (sign-in)", TokenHash = McpAgentAuthHandler.Hash(access1),
            Hint = access1.Substring(0, McpAgentToken.Prefix.Length + 4), CompanyIds = companyValue,
            Scopes = row.Scopes, AllowWrites = row.Scopes.Split(',').Any(McpScopes.IsWrite), CreatedAt = now, CreatedByUserId = user.Id,
            ExpiresAt = now.AddMinutes(AccessMinutes), OAuthClientId = clientId,
            RefreshHash = McpAgentAuthHandler.Hash(refresh), RefreshExpiresAt = now.AddDays(RefreshDays),
        };
        db.McpAgentTokens.Add(token);
        await db.SaveChangesAsync();
        await db.McpOAuthCodes.Where(c => c.Id == row.Id).ExecuteUpdateAsync(s => s.SetProperty(c => c.IssuedTokenId, token.Id));
        logger.LogInformation("MCP sign-in connection {TokenId} issued to client {ClientId} for user {UserId}", token.Id, clientId, user.Id);
        return TokenResponse(access1, refresh, row.Scopes);
    }

    private async Task<IActionResult> RefreshAsync(IFormCollection f)
    {
        string clientId = f["client_id"].ToString(), refresh = f["refresh_token"].ToString();
        if (clientId.Length == 0 || refresh.Length == 0) return OAuthError("invalid_request", "client_id and refresh_token are required.");
        var now = DateTime.UtcNow;
        var oldHash = McpAgentAuthHandler.Hash(refresh);
        var token = await db.McpAgentTokens.AsNoTracking().FirstOrDefaultAsync(t => t.RefreshHash == oldHash);
        if (token == null || token.RevokedAt != null || token.OAuthClientId != clientId || token.RefreshExpiresAt <= now)
            return OAuthError("invalid_grant", "The refresh token is not valid.");
        if (!await permissions.HasPermissionAsync(token.UserId, "mcp.access.use"))
            return OAuthError("invalid_grant", "MCP access is no longer enabled for this user.");

        var newAccess = McpAgentAuthHandler.NewSecret();
        var newRefresh = NewRefreshSecret();
        var newAccessHash = McpAgentAuthHandler.Hash(newAccess);
        var newRefreshHash = McpAgentAuthHandler.Hash(newRefresh);
        var expires = now.AddMinutes(AccessMinutes);
        var refreshExpires = now.AddDays(RefreshDays);
        // Rotate in one conditional write: a refresh secret works exactly once.
        var done = await db.McpAgentTokens.Where(t => t.Id == token.Id && t.RefreshHash == oldHash && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.TokenHash, newAccessHash).SetProperty(t => t.Hint, newAccess.Substring(0, McpAgentToken.Prefix.Length + 4))
                .SetProperty(t => t.ExpiresAt, expires).SetProperty(t => t.RefreshHash, newRefreshHash).SetProperty(t => t.RefreshExpiresAt, refreshExpires));
        if (done == 0) return OAuthError("invalid_grant", "The refresh token is not valid.");
        return TokenResponse(newAccess, newRefresh, token.Scopes);
    }

    // ── helpers ────────────────────────────────────────────────────────

    private IActionResult TokenResponse(string accessToken, string refreshToken, string scope) => Ok(new
    {
        access_token = accessToken, token_type = "Bearer", expires_in = AccessMinutes * 60, refresh_token = refreshToken, scope,
    });

    private IActionResult OAuthError(string error, string description, int status = 400)
    {
        NoStore();
        return StatusCode(status, new { error, error_description = description });
    }

    private void NoStore()
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
    }

    private static string? ValidateAuthRequest(string? responseType, string? challenge, string? method)
    {
        if (responseType != "code") return "unsupported_response_type";
        if (method != "S256" || string.IsNullOrEmpty(challenge) || challenge.Length is < 43 or > 128 || !challenge.All(IsB64UrlChar))
            return "invalid_request";
        return null;
    }

    private static bool IsB64UrlChar(char c) => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' or '.' or '~';

    private static string ErrorRedirect(string redirect, string error, string? state) =>
        AppendQuery(redirect, ("error", error), ("state", state));

    private static string AppendQuery(string baseUri, params (string Key, string? Value)[] pairs)
    {
        var sb = new StringBuilder(baseUri).Append(baseUri.Contains('?') ? '&' : '?');
        sb.Append(string.Join('&', pairs.Where(p => !string.IsNullOrEmpty(p.Value)).Select(p => $"{p.Key}={Uri.EscapeDataString(p.Value!)}")));
        return sb.ToString();
    }

    private async Task<McpOAuthClient?> FindClientAsync(string? id) =>
        string.IsNullOrEmpty(id) || id.Length > 64 ? null : await db.McpOAuthClients.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id);

    private static string NewRefreshSecret() => "tmcr_" + B64Url(RandomNumberGenerator.GetBytes(32));

    private static string B64Url(byte[] bytes) => Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
}
