using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers;

/// <summary>
/// What an agent token may be granted. "read" covers every read-only tool. A write scope is
/// offered to a user only when they hold the platform opt-in <c>mcp.write.use</c> AND the very
/// permission the matching screen needs, so a token can never exceed its owner's own authority.
/// </summary>
public static class McpScopes
{
    public const string Read = "read";
    public const string Clients = "clients.write";
    public const string Quotes = "quotes.write";
    public const string Challans = "challans.write";
    public const string Bills = "bills.write";

    /// <summary>Write scopes that have tools behind them today. Others are refused, not pre-granted.</summary>
    public static readonly string[] Write = { Clients, Quotes, Challans, Bills };
    public static readonly string[] Implemented = { Read, Clients, Quotes, Challans, Bills };

    // Permissions the owner must hold: ALL of "All", and at least one of "Any" (when listed).
    private static readonly Dictionary<string, (string[] All, string[] Any)> Needs = new()
    {
        [Clients] = (new[] { "clients.manage.create", "clients.manage.update" }, Array.Empty<string>()),
        [Quotes] = (new[] { "salesquotes.manage.create" }, Array.Empty<string>()),
        [Challans] = (new[] { "challans.manage.create", "challans.list.view" }, Array.Empty<string>()),
        // A bill is made from challans or on its own; the two are separately grantable screens.
        [Bills] = (new[] { "challans.list.view" }, new[] { "bills.manage.create", "bills.manage.create.standalone" }),
    };

    public static bool IsWrite(string scope) => Write.Contains(scope, StringComparer.Ordinal);

    /// <summary>The scopes this user may be offered right now.</summary>
    public static async Task<List<string>> AvailableAsync(IPermissionService permissions, int userId)
    {
        var scopes = new List<string> { Read };
        if (!await permissions.HasPermissionAsync(userId, "mcp.write.use")) return scopes;
        foreach (var scope in Write)
        {
            var (all, any) = Needs[scope];
            var ok = true;
            foreach (var key in all)
                if (!await permissions.HasPermissionAsync(userId, key)) { ok = false; break; }
            if (ok && any.Length > 0)
            {
                ok = false;
                foreach (var key in any)
                    if (await permissions.HasPermissionAsync(userId, key)) { ok = true; break; }
            }
            if (ok) scopes.Add(scope);
        }
        return scopes;
    }

    /// <summary>Normalises requested scopes; returns an error message, or null when they are acceptable.</summary>
    public static async Task<(List<string> Scopes, string? Error)> ValidateAsync(
        IPermissionService permissions, int userId, IEnumerable<string>? requested)
    {
        var scopes = (requested ?? Array.Empty<string>()).Select(s => s.Trim()).Distinct(StringComparer.Ordinal).ToList();
        if (scopes.Count == 0) return (scopes, "Choose at least one scope.");
        if (!scopes.Contains(Read)) scopes.Insert(0, Read);   // a write token can always read what it writes
        if (scopes.Any(s => !Implemented.Contains(s, StringComparer.Ordinal))) return (scopes, "That scope is not available.");
        var available = await AvailableAsync(permissions, userId);
        var denied = scopes.Where(s => !available.Contains(s, StringComparer.Ordinal)).ToList();
        if (denied.Count > 0)
            return (scopes, IsWrite(denied[0]) && !await permissions.HasPermissionAsync(userId, "mcp.write.use")
                ? "Write access is not enabled for that user. Assign the MCP Write role first."
                : "That user lacks the permission behind one of the chosen scopes.");
        return (scopes, null);
    }
}
