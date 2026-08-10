using System.Linq;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Curated "starter" roles seeded so provisioning a new user is one pick
    /// instead of hand-ticking dozens of permission boxes. Each bundle is a
    /// coherent job profile that works warning-free (paired with
    /// <see cref="ReferenceAccessPolicy"/> so the lookup pickers those roles
    /// need are co-authorized).
    ///
    /// Unlike the built-in Administrator role, starter roles are created as
    /// NON-system roles: an admin can rename, retune, clone or delete them.
    /// The seeder creates each only if no role with that name already exists
    /// (see <c>RbacSeeder.EnsureStarterRolesAsync</c>) so it never overwrites an
    /// operator's edits. These roles carry PERMISSIONS only — company/division
    /// access stays per-user (assigned at user-provisioning time).
    ///
    /// Every key here must exist in <see cref="PermissionCatalog"/>; unknown
    /// keys are ignored defensively by the seeder, but keep this list honest.
    /// </summary>
    public static class StarterRoleCatalog
    {
        public record StarterRoleDef(string Name, string Description, string[] PermissionKeys);

        public static readonly IReadOnlyList<StarterRoleDef> All = Build();

        private static List<StarterRoleDef> Build()
        {
            var list = new List<StarterRoleDef>
            {
                new("Sales Operator",
                    "Create and manage sales documents (quotes, orders, delivery challans, bills) and customers. Sees the sales dashboard. No FBR submission or accounting.",
                    new[]
                    {
                        "dashboard.view", "dashboard.kpi.sales.view",
                        "salesquotes.list.view", "salesquotes.manage.create", "salesquotes.manage.update", "salesquotes.print.view",
                        "salesorders.list.view", "salesorders.manage.create", "salesorders.manage.update", "salesorders.print.view",
                        "challans.list.view", "challans.manage.create", "challans.manage.update", "challans.manage.duplicate", "challans.print.view",
                        "bills.list.view", "bills.manage.create", "bills.manage.create.standalone", "bills.manage.update", "bills.print.view",
                        "invoices.list.view", "invoices.print.view",
                        "clients.manage.view", "clients.manage.create", "clients.manage.update",
                        "itemtypes.manage.view", "itemtypes.manage.create",
                        "noninventoryitems.list.view",
                        "itemratehistory.view",
                        "poformats.import.create",
                        "attachments.list.view", "attachments.manage.upload",
                    }),

                new("FBR Officer",
                    "Classify bills for FBR and validate/submit them to PRAL, issue Credit/Debit notes, and read FBR reports and the FBR communication monitor.",
                    new[]
                    {
                        "dashboard.view", "dashboard.kpi.fbr.view",
                        "bills.list.view",
                        "invoices.list.view",
                        "invoices.manage.update.itemtype", "invoices.manage.update.itemtype.qty",
                        "invoices.note.create",
                        "invoices.fbr.validate", "invoices.fbr.submit", "invoices.fbr.preview", "invoices.fbr.exclude",
                        "invoices.print.view",
                        "clients.manage.view",
                        "fbr.config.view", "fbr.lookup.view", "fbr.reference.read", "fbrmonitor.view",
                        "reports.sales.view", "reports.sales.export", "reports.taxsheet.view", "reports.taxsheet.export",
                    }),

                new("Bookkeeper",
                    "Enter sales bills and purchase bills and record receipts (money in) and payments (money out). Reads customers and suppliers. No FBR submission, no ledger administration.",
                    new[]
                    {
                        "dashboard.view", "dashboard.kpi.sales.view", "dashboard.kpi.purchases.view",
                        "bills.list.view", "bills.manage.create", "bills.manage.create.standalone", "bills.manage.update", "bills.print.view",
                        "purchasebills.list.view", "purchasebills.manage.create", "purchasebills.manage.update", "purchasebills.print.view",
                        "accounting.receipts.view", "accounting.receipts.create", "accounting.receipts.print",
                        "accounting.payments.view", "accounting.payments.create", "accounting.payments.print",
                        "clients.manage.view", "clients.manage.create",
                        "suppliers.manage.view", "suppliers.manage.create",
                        "itemtypes.manage.view",
                        "noninventoryitems.list.view",
                        "attachments.list.view", "attachments.manage.upload",
                    }),

                new("Inventory Manager",
                    "Manage stock: on-hand, movements, opening balances, adjustments; goods receipts; and the item-type catalog. Reads purchase bills and suppliers.",
                    new[]
                    {
                        "dashboard.view", "dashboard.kpi.inventory.view",
                        "stock.dashboard.view", "stock.movements.view", "stock.opening.manage", "stock.adjust.create",
                        "goodsreceipts.list.view", "goodsreceipts.manage.create", "goodsreceipts.manage.update", "goodsreceipts.print.view",
                        "purchasebills.list.view",
                        "itemtypes.manage.view", "itemtypes.manage.create", "itemtypes.manage.update",
                        "noninventoryitems.list.view",
                        "suppliers.manage.view",
                        "attachments.list.view", "attachments.manage.upload",
                    }),

                new("Accountant",
                    "Full accounting: receipts, payments, chart of accounts, journals, inter-account transfers, bank reconciliation and financial reports. Reads sales/purchase documents and parties.",
                    new[]
                    {
                        "dashboard.view", "dashboard.kpi.sales.view", "dashboard.kpi.purchases.view",
                        "accounting.receipts.view", "accounting.receipts.create", "accounting.receipts.delete", "accounting.receipts.print",
                        "accounting.payments.view", "accounting.payments.create", "accounting.payments.delete", "accounting.payments.print",
                        "accounting.coa.view", "accounting.coa.manage",
                        "accounting.journal.view", "accounting.journal.create", "accounting.journal.delete", "accounting.journal.print",
                        "accounting.transfers.view", "accounting.transfers.create", "accounting.transfers.delete", "accounting.transfers.print",
                        "accounting.reconciliation.view", "accounting.reconciliation.manage",
                        "accounting.reports.view", "accounting.dashboard.view",
                        "bills.list.view", "purchasebills.list.view",
                        "clients.manage.view", "suppliers.manage.view",
                        "reports.sales.view", "reports.taxsheet.view",
                    }),
            };

            // Read-Only Auditor: every read key in the catalog (anything ending in
            // ".view" or ".read") plus the two audit trails. Computed so it stays
            // complete automatically as the catalog grows — no mutation rights.
            var readKeys = PermissionCatalog.All
                .Select(p => p.Key)
                .Where(k => k.EndsWith(".view") || k.EndsWith(".read"))
                .Distinct()
                .ToArray();
            list.Add(new StarterRoleDef(
                "Read-Only Auditor",
                "See (and print/export) everything across the app without changing anything — every read permission plus the audit and FBR-communication logs.",
                readKeys));

            return list;
        }
    }
}
