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

        public const string SalesEditionDescription =
            "Sales edition — the full sales, purchase, inventory and FBR product, " +
            "including receipts and payments. No general ledger. Built-in: assign it, " +
            "clone it to vary it.";

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

        /// <summary>The seeded editions, in the order they should be listed.</summary>
        public static IReadOnlyList<(string Name, string Description, IReadOnlyList<string> Keys)> All { get; } =
            new List<(string, string, IReadOnlyList<string>)>
            {
                (SalesEditionRoleName,    SalesEditionDescription,    SalesEditionKeys),
                (CompleteEditionRoleName, CompleteEditionDescription, CompleteEditionKeys),
            };
    }
}
