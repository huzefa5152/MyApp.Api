namespace MyApp.Api.Helpers;

/// <summary>
/// The public origin of this site, as an AI client must see it in OAuth metadata. A
/// configured <c>Mcp:PublicBaseUrl</c> wins; otherwise it is built from the request, with
/// https forced for any host that is not loopback (a public site is only served over TLS,
/// and a proxy in front may have terminated it before the request reached us).
/// </summary>
public static class McpPublicUrl
{
    public static string Base(HttpContext http)
    {
        var configured = http.RequestServices.GetRequiredService<IConfiguration>()["Mcp:PublicBaseUrl"];
        if (!string.IsNullOrWhiteSpace(configured)) return configured.TrimEnd('/');
        var host = http.Request.Host;
        var loopback = host.Host is "localhost" or "127.0.0.1" or "[::1]" or "::1";
        return $"{(loopback ? http.Request.Scheme : "https")}://{host}";
    }

    public static string ProtectedResourceMetadata(HttpContext http) => Base(http) + "/.well-known/oauth-protected-resource";
}
