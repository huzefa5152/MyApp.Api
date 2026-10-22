using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Helpers;

/// <summary>
/// What an agent token may be granted. A scope is offered to a user only when at least one
/// tool behind it is open to them (<see cref="IPermissionService.HasMcpToolAccessAsync"/>:
/// MCP access, the write opt-in for write tools, the screen's own permission and the catalog
/// grant), so a token can never exceed its owner's own authority.
/// </summary>
public static class McpScopes
{
    public const string Read = "read";
    public const string TemplatesRead = "templates.read";
    public const string DocumentsRead = "documents.read";
    /// <summary>Not a write of business data, but it calls PRAL with the company's token, so it is granted explicitly.</summary>
    public const string FbrValidate = "fbr.validate";

    public const string Clients = "clients.write";
    public const string Suppliers = "suppliers.write";
    public const string ItemTypes = "itemtypes.write";
    public const string Quotes = "quotes.write";
    public const string Orders = "orders.write";
    public const string Challans = "challans.write";
    public const string Bills = "bills.write";
    public const string Purchases = "purchases.write";
    public const string Receipts = "receipts.write";
    public const string Payments = "payments.write";
    public const string Gds = "gds.write";
    public const string Lcs = "lcs.write";
    public const string Stock = "stock.write";
    public const string Journal = "journal.write";
    /// <summary>Deleting and cancelling documents: granted on its own, apart from creating them.</summary>
    public const string Delete = "delete.write";
    /// <summary>Filing bills with FBR (a legal invoice number that cannot be undone), resetting a stuck filing.</summary>
    public const string FbrSubmit = "fbr.submit";
    /// <summary>Account transfers, bank reconciliation and bank statements.</summary>
    public const string Banking = "banking.write";

    public static readonly string[] Write =
        { Clients, Suppliers, ItemTypes, Quotes, Orders, Challans, Bills, Purchases, Receipts, Payments, Gds, Lcs, Stock, Journal, Delete, FbrSubmit, Banking };
    public static readonly string[] Implemented = new[] { Read, TemplatesRead, DocumentsRead, FbrValidate }.Concat(Write).ToArray();

    /// <summary>
    /// The companies a token or connection is bound to. Everyone names between 1 and 50 companies they
    /// really reach. Only the primary admin may instead choose "all companies": the marker is read live,
    /// so tenants added later are included.
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
        if (!await permissions.HasPermissionAsync(userId, "mcp.access.use")) return new();
        var scopes = new List<string> { Read };
        foreach (var scope in Implemented.Where(s => s != Read))
            foreach (var tool in McpToolAccessCatalog.All.Where(t => t.Scope == scope && t.Configurable))
                if (await permissions.HasMcpToolAccessAsync(userId, tool.Name)) { scopes.Add(scope); break; }
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
                ? "Write access is not enabled for that user. Enable changes in their MCP Catalog Access settings."
                : "That user lacks the permission behind one of the chosen scopes.");
        return (scopes, null);
    }
}
