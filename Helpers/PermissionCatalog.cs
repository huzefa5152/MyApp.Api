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
            // ── Dashboard ──────────────────────────────────────────────────
            // Five-tier model: dashboard.view gates the page itself; the four
            // .kpi.* perms gate which sections of the page render. A user
            // with dashboard.view but no kpi.* perms sees only the welcome
            // banner — no money numbers leak.
            new("dashboard.view",                "Dashboard", "Page",          "View", "Access the Dashboard page"),
            new("dashboard.kpi.sales.view",      "Dashboard", "Sales KPI",     "View", "See sales KPIs (Total Sales, top clients, recent invoices, sales trend)"),
            new("dashboard.kpi.purchases.view",  "Dashboard", "Purchase KPI",  "View", "See purchase KPIs (Total Purchases, top suppliers, recent purchase bills, purchase trend)"),
            new("dashboard.kpi.fbr.view",        "Dashboard", "FBR KPI",       "View", "See FBR / compliance KPIs (pending submission, validated, submitted, failed)"),
            new("dashboard.kpi.inventory.view",  "Dashboard", "Inventory KPI", "View", "See inventory KPIs (stock value, low-stock items, recent stock movements, top items by movement)"),

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

            // ── Bills (data entry — no FBR concerns) ────────────────────────
            // Sales is split across two screens that view the same underlying
            // bill data:
            //   • Bills tab — operational billing (create / edit / delete /
            //     print). Item Type is the only FBR-classification field
            //     exposed here; HS Code / Sale Type / scenario picker are
            //     hidden.
            //   • Invoices tab — FBR classification & submission (Tax Invoice
            //     print / Validate / Submit / FBR preview / Exclude).
            // Each side has its own permissions so a bookkeeper role can hold
            // bills.* without invoices.fbr.*, and an FBR officer role can hold
            // invoices.fbr.* without bills.manage.*.
            new("bills.list.view",          "Bills", "List",   "View",   "View the bills list (powers both Bills and Invoices tabs)"),
            new("bills.manage.create",      "Bills", "Manage", "Create", "Create a new bill (challan-linked)"),
            // Standalone create — operator can issue a bill WITHOUT a linked
            // delivery challan. Carved out as a separate permission so a role
            // can be granted ONLY this without also gaining the regular
            // create-from-challan flow, or vice-versa.
            new("bills.manage.create.standalone", "Bills", "Manage", "Create (No Challan)", "Create a bill directly without linking a delivery challan"),
            new("bills.manage.update",      "Bills", "Manage", "Update", "Edit a bill (all fields)"),
            new("bills.manage.delete",      "Bills", "Manage", "Delete", "Delete a bill"),
            new("bills.print.view",         "Bills", "Print",  "View",   "Print or download a Bill (Bill print, Bill PDF, Bill XLS)"),

            // ── Invoices (FBR classification + submission) ──────────────────
            new("invoices.list.view",      "Invoices", "List",   "View",   "View the Invoices tab (FBR submission view of bills)"),
            // Narrow edit permissions live under Invoices because item-type
            // classification is the Invoices tab's responsibility — a Bills-
            // only user (bookkeeper) doesn't need to set ItemType. The
            // bookkeeping fields (price, dates, descriptions) stay locked
            // when these are the user's only update perm; only Item Type
            // (and optionally Qty) become editable.
            new("invoices.manage.update.itemtype",     "Invoices", "Manage", "Update Item Type",       "Edit ONLY the Item Type column on a bill from the Invoices tab"),
            new("invoices.manage.update.itemtype.qty", "Invoices", "Manage", "Update Item Type + Qty", "Edit Item Type and Quantity columns on a bill from the Invoices tab"),
            // Two granular FBR permissions — separating dry-run from real
            // submission so an operator can be allowed to validate without
            // being trusted to commit. A user with .submit but not .validate
            // would never get to use the validate button, so most roles will
            // get both. Granting .validate alone is the useful asymmetric case
            // (junior operator preparing bills, senior reviewer submits).
            new("invoices.fbr.validate",   "Invoices", "FBR",    "Validate", "Dry-run validate a bill with FBR (no commit, no IRN issued)"),
            new("invoices.fbr.submit",     "Invoices", "FBR",    "Submit",   "Submit a bill to FBR digital invoicing (commits, returns IRN)"),
            // View the JSON we would POST to FBR — grouped items, totals,
            // tax breakdown — without sending anything. Useful for review
            // / sign-off before clicking the real Validate / Submit button.
            new("invoices.fbr.preview",    "Invoices", "FBR",    "Preview",  "View the FBR submission preview (grouped items, totals, raw JSON) without sending to FBR"),
            // Independent permission for the per-bill "Exclude from FBR /
            // Include in FBR" toggle. Excluded bills are skipped by Validate
            // All / Submit All. Carved out of bills.manage.update so an
            // operator can be trusted to flip the toggle without being trusted
            // to edit prices, dates, or items on the bill itself.
            new("invoices.fbr.exclude",    "Invoices", "FBR",    "Exclude/Include", "Mark a bill as excluded from FBR bulk Validate/Submit, or re-include it"),
            new("invoices.print.view",     "Invoices", "Print",  "View",   "Print or download a Tax Invoice (Tax Invoice print, Tax PDF, Tax XLS)"),

            // ── PO Formats (Purchase-Order parser registry) ─────────────────
            new("poformats.manage.view",   "POFormats", "Manage", "View",   "View registered PO formats"),
            new("poformats.manage.create", "POFormats", "Manage", "Create", "Register a new PO format"),
            new("poformats.manage.update", "POFormats", "Manage", "Update", "Edit a PO format ruleset"),
            new("poformats.manage.delete", "POFormats", "Manage", "Delete", "Delete a PO format"),
            new("poformats.import.create",      "POFormats", "Import",        "Create", "Upload a PO file and import its parsed items"),
            new("poformats.import.viewArchive", "POFormats", "Import Archive", "View",   "List archived PO PDFs (with parse outcome) and download originals for triage"),

            // ── FBR Purchase Import (Annexure-A xls upload) ─────────────────
            new("fbrimport.purchase.preview", "FBR Import", "Purchase", "Preview", "Upload an FBR Annexure-A xls and view the per-row import preview (no writes)"),
            new("fbrimport.purchase.commit",  "FBR Import", "Purchase", "Commit",  "Commit an FBR Annexure-A import — auto-creates Suppliers, Purchase Bills, Item Types, and Stock Movements"),

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

            // ── Suppliers (mirror of Clients) ───────────────────────────────
            new("suppliers.manage.view",   "Suppliers", "Manage", "View",   "View the suppliers list"),
            new("suppliers.manage.create", "Suppliers", "Manage", "Create", "Create a new supplier"),
            new("suppliers.manage.update", "Suppliers", "Manage", "Update", "Edit supplier details"),
            new("suppliers.manage.delete", "Suppliers", "Manage", "Delete", "Delete a supplier"),

            // ── Purchase Bills ──────────────────────────────────────────────
            new("purchasebills.list.view",     "PurchaseBills", "List",   "View",   "View the purchase-bills list"),
            new("purchasebills.manage.create", "PurchaseBills", "Manage", "Create", "Create a new purchase bill (records supplier IRN and emits Stock IN)"),
            new("purchasebills.manage.update", "PurchaseBills", "Manage", "Update", "Edit a purchase bill"),
            new("purchasebills.manage.delete", "PurchaseBills", "Manage", "Delete", "Delete a purchase bill (reverses any Stock IN it emitted)"),
            new("purchasebills.print.view",    "PurchaseBills", "Print",  "View",   "Print or download purchase bills"),

            // ── Goods Receipts (mirror of Delivery Challans on the buy-side) ─
            new("goodsreceipts.list.view",     "GoodsReceipts", "List",   "View",   "View goods-receipt notes"),
            new("goodsreceipts.manage.create", "GoodsReceipts", "Manage", "Create", "Create a goods-receipt note"),
            new("goodsreceipts.manage.update", "GoodsReceipts", "Manage", "Update", "Edit a goods-receipt note"),
            new("goodsreceipts.manage.delete", "GoodsReceipts", "Manage", "Delete", "Delete a goods-receipt note"),

            // ── Inventory / Stock ───────────────────────────────────────────
            new("stock.dashboard.view",     "Inventory", "Dashboard",       "View",   "View on-hand stock dashboard"),
            new("stock.movements.view",     "Inventory", "Movements",       "View",   "View the stock-movement audit log"),
            new("stock.opening.manage",     "Inventory", "Opening Balance", "Manage", "Set or edit opening stock balance per item"),
            new("stock.adjust.create",      "Inventory", "Adjustment",      "Create", "Record a stock adjustment (count correction, write-off)"),

            // ── Audit Logs ──────────────────────────────────────────────────
            new("auditlogs.view",          "AuditLogs", "View", "View", "View application audit/exception logs"),

            // ── Tenant Access (User → Company assignments) ──────────────────
            // Decides who can SEE the per-company data. The `IsTenantIsolated`
            // flag on Company is the switch: while false, every authenticated
            // user with the right RBAC permission still reaches the company
            // (legacy/open mode); while true, only users with a matching
            // UserCompanies row pass the ICompanyAccessGuard. These two
            // permissions gate the UI that maintains those rows; flipping
            // IsTenantIsolated itself reuses companies.manage.update.
            new("tenantaccess.manage.view",   "Tenant Access", "Manage", "View",
                "View user → company tenant-access assignments"),
            new("tenantaccess.manage.assign", "Tenant Access", "Manage", "Assign",
                "Grant or revoke a user's access to specific companies"),
        };
    }
}
