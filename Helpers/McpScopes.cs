using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers;

/// <summary>
/// What an agent token may be granted. Print content needs separate explicit read scopes. A write scope is
/// offered to a user only when they hold the platform opt-in <c>mcp.write.use</c> AND the very
/// permission the matching screen needs, so a token can never exceed its owner's own authority.
/// </summary>
public static class McpScopes
{
    public const string Read = "read";
    public const string Clients = "clients.write";
    public const string Quotes = "quotes.write";
    public const string Email = "email.enquiries.write";
    public const string Challans = "challans.write";
    public const string Bills = "bills.write";
    public const string TemplatesRead = "templates.read";
    public const string DocumentsRead = "documents.read";

    /// <summary>Write scopes that have tools behind them today. Others are refused, not pre-granted.</summary>
    public static readonly string[] Write = { Clients, Quotes, Challans, Bills, Email };
    public static readonly string[] Implemented = { Read, TemplatesRead, DocumentsRead, Clients, Quotes, Challans, Bills, Email };

    // Permissions the owner must hold: ALL of "All", and at least one of "Any" (when listed).
    private static readonly Dictionary<string, (string[] All, string[] Any)> Needs = new()
    {
        [Clients] = (new[] { "clients.manage.create", "clients.manage.update" }, Array.Empty<string>()),
        [Quotes] = (new[] { "salesquotes.manage.create" }, Array.Empty<string>()),
        [Email] = (new[] { "email.workspace.use", "email.inbox.view", "email.inbox.manage" }, Array.Empty<string>()),
        [Challans] = (new[] { "challans.manage.create", "challans.list.view" }, Array.Empty<string>()),
        // A bill is made from challans or on its own; the two are separately grantable screens.
        [Bills] = (new[] { "challans.list.view" }, new[] { "bills.manage.create", "bills.manage.create.standalone" }),
    };

    /// <summary>
    /// The companies a token or connection is bound to. Everyone names between 1 and 50 companies they
    /// really reach. Only the primary admin may instead choose "all companies": the marker is read live,
    /// so tenants added later are included, which is exactly what a platform-wide assistant needs.
    /// </summary>
    public static (string? Value, string? Error) ResolveCompanies(bool all, IEnumerable<int>? requested, bool ownerIsSeedAdmin, HashSet<int> reachable)
    {
        if (all)
            return ownerIsSeedAdmin ? (McpAgentToken.AllCompaniesMarker, null) : (null, "Only the primary admin can choose all companies.");
        var ids = (requested ?? Array.Empty<int>()).Distinct().ToList();
        if (ids.Count is < 1 or > 50) return (null, "Choose between 1 and 50 companies.");
        if (ids.Any(id => !reachable.Contains(id))) return (null, "A token can only name companies its user can reach.");
        return (string.Join(',', ids), null);
    }

    public static int MaxLifetimeDays(bool ownerIsSeedAdmin) =>
        ownerIsSeedAdmin ? McpAgentToken.SeedAdminMaxLifetimeDays : McpAgentToken.MaxLifetimeDays;

    public static bool IsWrite(string scope) => Write.Contains(scope, StringComparer.Ordinal);

    /// <summary>The scopes this user may be offered right now.</summary>
    public static async Task<List<string>> AvailableAsync(IPermissionService permissions, int userId)
    {
        var scopes = new List<string> { Read };
        if (await permissions.HasPermissionAsync(userId, "printtemplates.manage.view")) scopes.Add(TemplatesRead);
        foreach (var key in new[] { "challans.print.view", "bills.print.view", "invoices.print.view", "salesquotes.print.view",
            "salesorders.print.view", "purchasebills.print.view", "goodsreceipts.print.view", "accounting.receipts.print", "accounting.payments.print", "withholdingtax.print.view" })
            if (await permissions.HasPermissionAsync(userId, key)) { scopes.Add(DocumentsRead); break; }
        if (!await permissions.HasPermissionAsync(userId, "mcp.access.use")) return new();
        if (!await permissions.HasPermissionAsync(userId, "mcp.write.use"))
            return await FilterCatalogAsync(permissions, userId, scopes);
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
        return await FilterCatalogAsync(permissions, userId, scopes);
    }

    private static async Task<List<string>> FilterCatalogAsync(IPermissionService permissions, int userId, List<string> scopes)
    {
        var available = new List<string>();
        foreach (var scope in scopes)
        {
            if (scope == Read) { available.Add(scope); continue; }
            foreach (var tool in McpToolAccessCatalog.All.Where(t => t.Scope == scope && t.Configurable))
                if (await permissions.HasMcpToolAccessAsync(userId, tool.Name)) { available.Add(scope); break; }
        }
        return available;
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
                ? "Write access is not enabled for that user. Enable changes in their MCP Catalog Access settings."
                : "That user lacks the permission behind one of the chosen scopes.");
        return (scopes, null);
    }
}
