using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;
namespace MyApp.Api.Services.Implementations;

public sealed class GmailProvider(HttpClient http, IConfiguration config) : IGmailProvider
{
    public const string ReadScope = "https://www.googleapis.com/auth/gmail.readonly";
    private string ClientId => config["Gmail:ClientId"] ?? "";
    private string ClientSecret => config["Gmail:ClientSecret"] ?? "";
    public string RedirectUri => config["Gmail:RedirectUri"] ?? "";
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId) && !string.IsNullOrWhiteSpace(ClientSecret)
        && Uri.TryCreate(RedirectUri, UriKind.Absolute, out var uri)
        && (uri.Scheme == "https" || uri.IsLoopback && uri.Scheme == "http");
    private const string Api = "https://gmail.googleapis.com/gmail/v1/users/me/";
    public string AuthorizationUrl(string state, string challenge)
    {
        if (!IsConfigured) throw new InvalidOperationException("Gmail is not configured.");
        return "https://accounts.google.com/o/oauth2/v2/auth?" + Form(new()
        {
            ["client_id"] = ClientId, ["redirect_uri"] = RedirectUri, ["response_type"] = "code",
            ["scope"] = "openid email " + ReadScope, ["access_type"] = "offline", ["prompt"] = "consent select_account",
            ["state"] = state, ["code_challenge"] = challenge, ["code_challenge_method"] = "S256"
        });
    }
    private static string Form(Dictionary<string, string> fields) =>
        string.Join("&", fields.Select(x => Uri.EscapeDataString(x.Key) + "=" + Uri.EscapeDataString(x.Value)));
    public async Task<GmailIdentity> ExchangeAsync(string code, string verifier, CancellationToken ct)
    {
        using var token = await TokenAsync(new() { ["code"] = code, ["code_verifier"] = verifier,
            ["grant_type"] = "authorization_code", ["redirect_uri"] = RedirectUri }, ct);
        var root = token.RootElement;
        if (!root.TryGetProperty("scope", out var scope) || !(scope.GetString() ?? "").Split(' ').Contains(ReadScope))
            throw new InvalidOperationException("Gmail read access was not granted.");
        var access = root.GetProperty("access_token").GetString()!;
        var refresh = root.TryGetProperty("refresh_token", out var r) ? r.GetString() : null;
        if (string.IsNullOrEmpty(refresh)) throw new InvalidOperationException("Offline access was not granted. Reconnect Gmail.");
        using var identity = await GetAsync("https://openidconnect.googleapis.com/v1/userinfo", access, ct);
        var i = identity.RootElement;
        if (!i.TryGetProperty("email_verified", out var verified) || !verified.GetBoolean())
            throw new InvalidOperationException("A verified Google email is required.");
        return new(i.GetProperty("sub").GetString()!, i.GetProperty("email").GetString()!, refresh);
    }
    public async Task<string> RefreshAsync(string refreshToken, CancellationToken ct)
    {
        using var doc = await TokenAsync(new() { ["refresh_token"] = refreshToken, ["grant_type"] = "refresh_token" }, ct);
        return doc.RootElement.GetProperty("access_token").GetString()!;
    }
    private async Task<JsonDocument> TokenAsync(Dictionary<string, string> fields, CancellationToken ct)
    {
        fields["client_id"] = ClientId; fields["client_secret"] = ClientSecret;
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://oauth2.googleapis.com/token")
        { Content = new FormUrlEncodedContent(fields) };
        return await SendAsync(request, ct);
    }
    private async Task<JsonDocument> GetAsync(string url, string token, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return await SendAsync(request, ct);
    }
    private async Task<JsonDocument> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new GmailProviderException(response.StatusCode);
        if (response.Content.Headers.ContentLength > 16 * 1024 * 1024) throw new InvalidOperationException("Gmail response is too large.");
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var buffer = new MemoryStream();
        var bytes = new byte[8192];
        int count;
        while ((count = await stream.ReadAsync(bytes, ct)) > 0)
        {
            if (buffer.Length + count > 16 * 1024 * 1024) throw new InvalidOperationException("Gmail response is too large.");
            await buffer.WriteAsync(bytes.AsMemory(0, count), ct);
        }
        return JsonDocument.Parse(buffer.ToArray());
    }
    public async Task<string> GetHistoryIdAsync(string token, CancellationToken ct)
    {
        using var doc = await GetAsync(Api + "profile", token, ct);
        return doc.RootElement.GetProperty("historyId").GetString()!;
    }
    public async Task<GmailBatch> ListAsync(string token, DateTime since, string? pageToken, CancellationToken ct)
    {
        var query = "after:" + new DateTimeOffset(DateTime.SpecifyKind(since, DateTimeKind.Utc)).ToUnixTimeSeconds() + " -in:spam -in:trash -in:sent -in:drafts";
        using var doc = await GetAsync(Api + "messages?maxResults=50&q=" + Uri.EscapeDataString(query)
            + (pageToken == null ? "" : "&pageToken=" + Uri.EscapeDataString(pageToken)), token, ct);
        var r = doc.RootElement;
        return new(r.TryGetProperty("messages", out var m) ? m.EnumerateArray().Select(x => x.GetProperty("id").GetString()!).ToList() : new(),
            r.TryGetProperty("nextPageToken", out var p) ? p.GetString() : null, null);
    }
    public async Task<GmailBatch> HistoryAsync(string token, string historyId, string? pageToken, CancellationToken ct)
    {
        using var doc = await GetAsync(Api + "history?maxResults=50&historyTypes=messageAdded&startHistoryId="
            + Uri.EscapeDataString(historyId) + (pageToken == null ? "" : "&pageToken=" + Uri.EscapeDataString(pageToken)), token, ct);
        var r = doc.RootElement; var ids = new HashSet<string>();
        if (r.TryGetProperty("history", out var h))
            foreach (var entry in h.EnumerateArray())
                if (entry.TryGetProperty("messagesAdded", out var added))
                    foreach (var a in added.EnumerateArray()) ids.Add(a.GetProperty("message").GetProperty("id").GetString()!);
        return new(ids.ToList(), r.TryGetProperty("nextPageToken", out var p) ? p.GetString() : null, r.GetProperty("historyId").GetString());
    }
    public async Task<GmailFetchedMessage?> ReadAsync(string token, string id, CancellationToken ct)
    {
        JsonDocument doc;
        try { doc = await GetAsync(Api + "messages/" + Uri.EscapeDataString(id) + "?format=full", token, ct); }
        catch (GmailProviderException e) when (e.StatusCode == HttpStatusCode.NotFound) { return null; }
        using (doc)
        {
            var r = doc.RootElement;
            if (r.TryGetProperty("labelIds", out var labels) && labels.EnumerateArray().Any(l => l.GetString() is "SPAM" or "TRASH" or "DRAFT" or "SENT")) return null;
            var payload = r.GetProperty("payload");
            var headers = payload.GetProperty("headers").EnumerateArray().ToList();
            string Header(string name) => headers.FirstOrDefault(h => string.Equals(h.GetProperty("name").GetString(), name, StringComparison.OrdinalIgnoreCase))
                is var found && found.ValueKind != JsonValueKind.Undefined ? found.GetProperty("value").GetString() ?? "" : "";
            var from = Header("From");
            try { from = Helpers.EmailWorkspaceRules.NormalizeAddress(from); } catch { from = ""; }
            var text = new StringBuilder(); var html = new StringBuilder(); var attachments = new List<EmailAttachmentInfo>();
            void Walk(JsonElement part, int depth)
            {
                if (depth > 20) return;
                var mime = part.TryGetProperty("mimeType", out var mt) ? mt.GetString() ?? "" : "";
                var file = part.TryGetProperty("filename", out var fn) ? fn.GetString() ?? "" : "";
                if (part.TryGetProperty("body", out var body))
                {
                    if (body.TryGetProperty("attachmentId", out var aid) && file.Length > 0)
                        attachments.Add(new(aid.GetString()!, Path.GetFileName(file), mime, body.TryGetProperty("size", out var size) ? size.GetInt32() : 0));
                    if (body.TryGetProperty("data", out var data) && file.Length == 0)
                    {
                        var encoded = data.GetString() ?? "";
                        if (encoded.Length < 2 * 1024 * 1024)
                        {
                            var value = Encoding.UTF8.GetString(Decode(encoded));
                            if (mime == "text/plain" && text.Length + value.Length < 1024 * 1024) text.AppendLine(value);
                            if (mime == "text/html" && html.Length + value.Length < 1024 * 1024) html.AppendLine(value);
                        }
                    }
                }
                // Attached messages are source files, not additional bodies of the current enquiry.
                if (file.Length > 0 || mime == "message/rfc822") return;
                if (part.TryGetProperty("parts", out var parts)) foreach (var p in parts.EnumerateArray()) Walk(p, depth + 1);
            }
            Walk(payload, 0);
            return new(id, r.GetProperty("threadId").GetString()!, from, Header("Subject")[..Math.Min(Header("Subject").Length, 1000)],
                DateTimeOffset.FromUnixTimeMilliseconds(long.Parse(r.GetProperty("internalDate").GetString()!)).UtcDateTime,
                new(text.ToString(), html.ToString(), attachments.Take(100).ToList()));
        }
    }
    public async Task<byte[]> AttachmentAsync(string token, string messageId, string attachmentId, CancellationToken ct)
    {
        using var doc = await GetAsync(Api + "messages/" + Uri.EscapeDataString(messageId) + "/attachments/" + Uri.EscapeDataString(attachmentId), token, ct);
        return Decode(doc.RootElement.GetProperty("data").GetString()!);
    }
    private static byte[] Decode(string data)
    {
        var value = data.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(value.PadRight((value.Length + 3) / 4 * 4, '='));
    }
}
public sealed class GmailProviderException(HttpStatusCode statusCode) : Exception("Gmail request failed.")
{
    public HttpStatusCode StatusCode { get; } = statusCode;
}
