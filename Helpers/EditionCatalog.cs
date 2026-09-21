namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The product editions this line is sold as, expressed as permission sets.
    ///
    /// The Trader build is sold two ways: a <b>Sales</b> edition — the whole
    /// sales, purchase, inventory and FBR product, including money in and money
    /// out — and a <b>Complete</b> edition that adds the accounting module (the
    /// chart of accounts, the general ledger, manual journals, the accounting
    /// reports and the customer portal). Both are seeded as system roles so a
    /// tenant is put on an edition by assigning one role, and the tier cannot
    /// be edited out of shape: <c>RolesController</c> refuses update and delete
    /// on a system role.
    ///
    /// Two rules define the split, and both are stated as code rather than a
    /// hand-maintained list, so a permission added to the catalog lands in the
    /// right edition automatically instead of being silently left out:
    ///
    /// 1. <see cref="VendorOnlyModules"/> — user, role, tenant-access and audit
    ///    administration belongs to whoever operates the software, not to the
    ///    tenant using it. It is excluded from BOTH editions. This is load
    ///    bearing: <c>RolesController</c> accepts any catalog key when a role is
    ///    edited, so a tenant holding <c>rbac.roles.update</c> could add the
    ///    accounting keys to their own role and walk straight through the
    ///    edition boundary. Keeping role administration out of the editions is
    ///    what makes the boundary mean anything.
    /// 2. <see cref="AccountingModulePrefixes"/> — the keys the accounting
    ///    module added. Everything else is the Sales edition.
    ///
    /// Note what is NOT in that second rule: <c>accounting.receipts.*</c>,
    /// <c>accounting.payments.*</c> and <c>accounting.paymentstatus.*</c>. They
    /// share the <c>accounting.</c> namespace but predate the module and need no
    /// ledger — recording a receipt against an invoice is a sales activity. They
    /// are in the Sales edition, which is why the split is by key prefix and not
    /// by the catalog's <c>Module</c> column.
    /// </summary>
    public static class EditionCatalog
    {
        public const string SalesEditionRoleName = "Sales Edition";
        public const string CompleteEditionRoleName = "Complete Edition";
        public const string TenantAdminRoleName = "Tenant Administrator";

        public const string SalesEditionDescription =
            "Sales edition — the full sales, purchase, inventory and FBR product, " +
            "including receipts and payments. No general ledger. Built-in: assign it, " +
            "clone it to vary it.";

        public const string TenantAdminDescription =
            "Tenant Administrator — may create staff accounts, build roles for them, " +
            "grant them companies and read the audit log for those companies. Holds NO " +
            "product features of its own: assign it ALONGSIDE an edition, and the " +
            "edition is what bounds it. Built-in.";

        /// <summary>
        /// Administration of a tenant's OWN people, and nothing else. It is a
        /// separate role rather than a second pair of editions on purpose:
        /// "Sales Edition + Tenant Administrator" and "Complete Edition +
        /// Tenant Administrator" are the two admins, composed rather than
        /// duplicated, and adding a third edition later costs nothing.
        ///
        /// What bounds such an admin is not this list but the rule in
        /// <c>RolesController.GrantableKeysAsync</c>: nobody may put a key into
        /// a role, or assign a role carrying one, unless they hold it
        /// themselves. So an admin on the Sales edition can build any role they
        /// like out of Sales keys and can never reach the accounting ones —
        /// including by assigning the Complete edition, which is visible to
        /// them (every system role is) but not grantable.
        ///
        /// <c>auditlogs.view</c> IS here, but only since 2026-09-21, when the
        /// audit log was scoped by company. Before that it was a single
        /// unscoped table and the key handed one tenant every other tenant's
        /// activity. A scoped administrator now sees rows belonging to their own
        /// companies and never the CompanyId-less platform rows (login failures,
        /// startup), so their log is honestly partial rather than misleadingly
        /// complete. If the log is ever un-scoped again, take this key back out.
        ///
        /// One key is still deliberately absent:
        /// <list type="bullet">
        /// <item><c>tenantaccess.manage.update</c> — that toggles
        /// <c>Company.IsTenantIsolated</c>, which decides who can see a company
        /// at all. That is a platform decision, not a tenant one.</item>
        /// </list>
        /// Company grants ARE included, and are already bounded elsewhere:
        /// <c>IManagementScopeService.GetAssignableCompanyIdsAsync</c> lets an
        /// administrator hand out only companies it holds itself.
        /// </summary>
        private static readonly string[] TenantAdminKeys =
        {
            "users.manage.view", "users.manage.create", "users.manage.update", "users.manage.delete",
            "rbac.roles.view", "rbac.roles.create", "rbac.roles.update", "rbac.roles.delete",
            "rbac.permissions.view", "rbac.userroles.view", "rbac.userroles.assign",
            "tenantaccess.manage.view", "tenantaccess.manage.assign",
            "auditlogs.view",
        };

        public const string CompleteEditionDescription =
            "Complete edition — everything in the Sales edition plus the accounting " +
            "module: chart of accounts, general ledger, journal entries, accounting " +
            "reports and customer portals. Built-in: assign it, clone it to vary it.";

        /// <summary>
        /// Administration of the software itself. Excluded from every edition —
        /// see the type remarks for why this is a boundary and not a preference.
        /// </summary>
        private static readonly HashSet<string> VendorOnlyModules =
            new(StringComparer.OrdinalIgnoreCase) { "RBAC", "Users", "AuditLogs", "Tenant Access" };

        /// <summary>
        /// Key prefixes the accounting module owns. Receipts and payments are
        /// deliberately absent — see the type remarks.
        /// </summary>
        private static readonly string[] AccountingModulePrefixes =
        {
            "accounting.coa.",
            "accounting.gl.",
            "accounting.journal.",
            "accounting.reports.",
            "customerportals.",
        };

        public static bool IsVendorOnly(PermissionCatalog.PermissionDef def) =>
            VendorOnlyModules.Contains(def.Module);

        public static bool IsAccountingModule(PermissionCatalog.PermissionDef def) =>
            AccountingModulePrefixes.Any(p => def.Key.StartsWith(p, StringComparison.OrdinalIgnoreCase));

        /// <summary>Everything a tenant on the Sales edition may do.</summary>
        public static IReadOnlyList<string> SalesEditionKeys { get; } =
            PermissionCatalog.All
                .Where(d => !IsVendorOnly(d) && !IsAccountingModule(d))
                .Select(d => d.Key)
                .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

        /// <summary>Everything a tenant on the Complete edition may do.</summary>
        public static IReadOnlyList<string> CompleteEditionKeys { get; } =
            PermissionCatalog.All
                .Where(d => !IsVendorOnly(d))
                .Select(d => d.Key)
                .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

        /// <summary>Administration keys that really exist in the catalog.</summary>
        public static IReadOnlyList<string> TenantAdminEffectiveKeys { get; } =
            PermissionCatalog.All
                .Where(d => TenantAdminKeys.Contains(d.Key, StringComparer.OrdinalIgnoreCase))
                .Select(d => d.Key)
                .OrderBy(k => k, StringComparer.OrdinalIgnoreCase)
                .ToList();

        /// <summary>The seeded roles, in the order they should be listed.</summary>
        public static IReadOnlyList<(string Name, string Description, IReadOnlyList<string> Keys)> All { get; } =
            new List<(string, string, IReadOnlyList<string>)>
            {
                (SalesEditionRoleName,    SalesEditionDescription,    SalesEditionKeys),
                (CompleteEditionRoleName, CompleteEditionDescription, CompleteEditionKeys),
                (TenantAdminRoleName,     TenantAdminDescription,     TenantAdminEffectiveKeys),
            };
    }
}
