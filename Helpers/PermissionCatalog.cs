namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Single source of truth for every permission the application recognises.
    /// Keys follow the format <c>module.page.action</c>. On application startup
    /// the seeder upserts this list into the <c>Permissions</c> table and
    /// removes any stale rows whose keys no longer appear here.
    ///
    /// New permissions are added here (in code) — admins cannot invent keys
    /// through the UI.
    /// </summary>
    public static class PermissionCatalog
    {
        public record PermissionDef(string Key, string Module, string Page, string Action, string Description);

        public static readonly IReadOnlyList<PermissionDef> All = new List<PermissionDef>
        {
            // ── RBAC (role & permission administration) ─────────────────────
            new("rbac.roles.view",         "RBAC", "Roles",        "View",   "View the list of roles and their assigned permissions"),
            new("rbac.roles.create",       "RBAC", "Roles",        "Create", "Create new roles"),
            new("rbac.roles.update",       "RBAC", "Roles",        "Update", "Rename a role or change which permissions it grants"),
            new("rbac.roles.delete",       "RBAC", "Roles",        "Delete", "Delete a non-system role"),
            new("rbac.permissions.view",   "RBAC", "Permissions",  "View",   "View the catalog of available permissions"),
            new("rbac.userroles.view",     "RBAC", "UserRoles",    "View",   "View which roles are assigned to each user"),
            new("rbac.userroles.assign",   "RBAC", "UserRoles",    "Assign", "Assign or unassign roles on a user"),

            // ── Users ───────────────────────────────────────────────────────
            new("users.manage.view",       "Users", "Manage", "View",   "View the users list and user details"),
            new("users.manage.create",     "Users", "Manage", "Create", "Create new users"),
            new("users.manage.update",     "Users", "Manage", "Update", "Edit existing users"),
            new("users.manage.delete",     "Users", "Manage", "Delete", "Delete users"),

            // ── Companies ───────────────────────────────────────────────────
            new("companies.manage.view",   "Companies", "Manage", "View",   "View the companies list"),
            new("companies.manage.create", "Companies", "Manage", "Create", "Create a new company"),
            new("companies.manage.update", "Companies", "Manage", "Update", "Edit company details"),
            new("companies.manage.delete", "Companies", "Manage", "Delete", "Delete a company"),

            // ── Clients ─────────────────────────────────────────────────────
            new("clients.manage.view",     "Clients", "Manage", "View",   "View the clients list"),
            new("clients.manage.create",   "Clients", "Manage", "Create", "Create a new client"),
            new("clients.manage.update",   "Clients", "Manage", "Update", "Edit client details"),
            new("clients.manage.delete",   "Clients", "Manage", "Delete", "Delete a client"),

            // ── Delivery Challans ───────────────────────────────────────────
            new("challans.list.view",      "Challans", "List",   "View",   "View the delivery-challan list"),
            new("challans.manage.create",  "Challans", "Manage", "Create", "Create a new delivery challan"),
            new("challans.manage.update",  "Challans", "Manage", "Update", "Edit a delivery challan"),
            new("challans.manage.delete",  "Challans", "Manage", "Delete", "Delete a delivery challan"),
            new("challans.import.create",  "Challans", "Import", "Create", "Import challans from an Excel template"),
            new("challans.print.view",     "Challans", "Print",  "View",   "Print or download challans"),

            // ── Invoices ────────────────────────────────────────────────────
            new("invoices.list.view",      "Invoices", "List",   "View",   "View the invoices list"),
            new("invoices.manage.create",  "Invoices", "Manage", "Create", "Create a new invoice"),
            new("invoices.manage.update",  "Invoices", "Manage", "Update", "Edit an invoice (all fields)"),
            // Narrow permission: lets a user re-classify an invoice line by
            // picking a different ItemType, but blocks every other edit
            // (price, qty, description, GST rate, dates, payment terms,
            // doc type, etc.). Useful for FBR-classification helpers who
            // shouldn't touch commercial values. SUPERSEDED by the broader
            // invoices.manage.update — granting both is safe; granting only
            // .itemtype restricts the user to the narrow flow.
            new("invoices.manage.update.itemtype", "Invoices", "Manage", "Update Item Type", "Edit ONLY the Item Type column on a bill (no other fields)"),
            new("invoices.manage.delete",  "Invoices", "Manage", "Delete", "Delete an invoice"),
            new("invoices.fbr.post",       "Invoices", "FBR",    "Post",   "Submit an invoice to FBR digital invoicing"),
            new("invoices.print.view",     "Invoices", "Print",  "View",   "Print or download invoices"),

            // ── PO Formats (Purchase-Order parser registry) ─────────────────
            new("poformats.manage.view",   "POFormats", "Manage", "View",   "View registered PO formats"),
            new("poformats.manage.create", "POFormats", "Manage", "Create", "Register a new PO format"),
            new("poformats.manage.update", "POFormats", "Manage", "Update", "Edit a PO format ruleset"),
            new("poformats.manage.delete", "POFormats", "Manage", "Delete", "Delete a PO format"),
            new("poformats.import.create", "POFormats", "Import", "Create", "Upload a PO file and import its parsed items"),

            // ── Print Templates ─────────────────────────────────────────────
            new("printtemplates.manage.view",   "PrintTemplates", "Manage", "View",   "View print/merge templates"),
            new("printtemplates.manage.update", "PrintTemplates", "Manage", "Update", "Edit a print template"),

            // ── FBR Configuration ───────────────────────────────────────────
            new("fbr.config.view",         "FBR", "Config", "View",   "View FBR configuration and credentials"),
            new("fbr.config.update",       "FBR", "Config", "Update", "Edit FBR configuration and credentials"),
            new("fbr.lookup.view",         "FBR", "Lookup", "View",   "View FBR lookup tables (provinces, HS codes, etc.)"),

            // ── FBR Sandbox (scenario test bills, isolated 900000+ numbering) ─
            new("fbr.sandbox.view",        "FBR", "Sandbox", "View",   "View the FBR Sandbox tab and demo scenario bills"),
            new("fbr.sandbox.seed",        "FBR", "Sandbox", "Seed",   "Auto-create demo scenario bills for a company"),
            new("fbr.sandbox.run",         "FBR", "Sandbox", "Run",    "Validate / submit demo scenario bills against PRAL"),
            new("fbr.sandbox.delete",      "FBR", "Sandbox", "Delete", "Delete demo scenario bills and challans"),

            // ── Item Types / Descriptions / Units ───────────────────────────
            new("itemtypes.manage.view",   "ItemTypes", "Manage", "View",   "View item types"),
            new("itemtypes.manage.create", "ItemTypes", "Manage", "Create", "Create a new item type"),
            new("itemtypes.manage.update", "ItemTypes", "Manage", "Update", "Edit an item type"),
            new("itemtypes.manage.delete", "ItemTypes", "Manage", "Delete", "Delete an item type"),

            new("config.itemdescriptions.manage", "Configuration", "ItemDescriptions", "Manage", "Manage the item-description lookup list"),
            new("config.units.manage",            "Configuration", "Units",            "Manage", "Manage the units-of-measure lookup list"),
            new("config.mergefields.manage",      "Configuration", "MergeFields",      "Manage", "Manage mergeable template fields"),

            // ── Item Rate History (search past rates billed for any item) ───
            new("itemratehistory.view",    "Item Rate History", "View", "View", "View the Item Rate History page (past unit prices billed for an item)"),

            // ── Audit Logs ──────────────────────────────────────────────────
            new("auditlogs.view",          "AuditLogs", "View", "View", "View application audit/exception logs"),
        };
    }
}
