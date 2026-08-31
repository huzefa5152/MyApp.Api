using System.Linq;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Single source of truth for "who may read a lookup/reference FEED".
    ///
    /// A lookup feed is a GET that populates a dropdown/picker inside ANOTHER
    /// module's create/edit form (the client picker on a Sales Quote, the
    /// supplier picker on a Purchase Bill, the division picker everywhere, …).
    ///
    /// Historically each feed was gated on the SAME single key that opens the
    /// module's own full page (e.g. <c>clients.manage.view</c>). That coupled
    /// "can create an invoice" to "can see the whole Clients tab": a role that
    /// only creates documents 403'd on the picker feed and the operator saw a
    /// spurious "you don't have permission" warning — the only workaround was
    /// over-granting the view key (which also surfaced the sidebar tab).
    ///
    /// This policy breaks that coupling. Each feed is authorized by its OWN
    /// view key OR any document permission that legitimately needs the picker.
    /// The <see cref="Middleware.HasReferenceAccessAttribute"/> resolves the key
    /// set from here and reuses the existing OR-filter engine.
    ///
    /// IMPORTANT — this relaxes the PERMISSION check only. Every feed endpoint
    /// still runs its tenant/company access check (ICompanyAccessGuard /
    /// [AuthorizeCompany]); a user with no access to the company still 403s.
    /// Sensitive read surfaces (client summary / AR statement / full lists)
    /// keep their own <c>*.manage.view</c> gate — only the plain picker list is
    /// co-authorized here. No new permission keys are introduced.
    /// </summary>
    public static class ReferenceAccessPolicy
    {
        // The "operator who builds SALES documents" key set. Any of these needs
        // the client / division / item pickers on a sales create-edit form.
        private static readonly string[] SalesDocKeys =
        {
            "salesquotes.manage.create", "salesquotes.manage.update",
            "salesorders.manage.create", "salesorders.manage.update",
            "challans.manage.create",    "challans.manage.update", "challans.manage.duplicate",
            "bills.manage.create",       "bills.manage.create.standalone", "bills.manage.update",
            "invoices.note.create",
            "withholdingtax.manage.create", "withholdingtax.manage.update",
            "accounting.receipts.create",
            "poformats.import.create",
        };

        // The "operator who builds PURCHASE documents" key set. Any of these
        // needs the supplier / division / item pickers on a purchase form.
        private static readonly string[] PurchaseDocKeys =
        {
            "purchasebills.manage.create", "purchasebills.manage.update",
            "goodsreceipts.manage.create", "goodsreceipts.manage.update",
            "purchasedebitnotes.manage.create", "purchasedebitnotes.manage.update",
            "accounting.payments.create",
        };

        // The per-line GL AccountSelect appears on sales bills + purchase bills +
        // payment adjustments + manual journals.
        private static readonly string[] AccountsKeys =
        {
            "accounting.coa.view", "accounting.journal.create",
            "bills.manage.create", "bills.manage.create.standalone", "bills.manage.update",
            "purchasebills.manage.create", "purchasebills.manage.update",
            "accounting.receipts.create", "accounting.payments.create",
        };

        // The print-template picker appears on every document print screen.
        private static readonly string[] PrintTemplateKeys =
        {
            "printtemplates.manage.view",
            "salesquotes.print.view", "salesorders.print.view", "challans.print.view",
            "bills.print.view", "invoices.print.view", "purchasebills.print.view",
            "goodsreceipts.print.view", "withholdingtax.print.view", "purchasedebitnotes.print.view",
            "accounting.receipts.print", "accounting.payments.print",
            "accounting.transfers.print", "accounting.journal.print",
        };

        /// <summary>policy name → keys allowed to read that feed (own view key first).</summary>
        public static readonly IReadOnlyDictionary<string, string[]> Map =
            new Dictionary<string, string[]>
            {
                // "customerportal.manage.create" is here because the Create Portal
                // dialog's only input IS a client picker — without it a role
                // granted just customerportal.* would 403 on the very screen those
                // permissions exist for, which is exactly the coupling this policy
                // was written to remove.
                // "reports.clientledger.view" is here for the same reason as the
                // portal key below it: the Client Ledger report's customer filter
                // IS a client picker, and its options must include customers the
                // report itself omits (a dormant one with no balance and no
                // activity). Sourcing that picker from the report's own payload
                // would make exactly those customers unreachable. It surfaces no
                // name the holder cannot already read on the report.
                ["clients"]        = new[] { "clients.manage.view", "customerportal.manage.create",
                                             "reports.clientledger.view" }
                                        .Concat(SalesDocKeys).ToArray(),
                ["suppliers"]      = new[] { "suppliers.manage.view" }.Concat(PurchaseDocKeys).ToArray(),
                ["divisions"]      = new[] { "divisions.manage.view" }
                                        .Concat(SalesDocKeys).Concat(PurchaseDocKeys).ToArray(),
                ["noninventory"]   = new[] { "noninventoryitems.list.view" }
                                        .Concat(SalesDocKeys).Concat(PurchaseDocKeys).ToArray(),
                ["salesorders"]    = new[] { "salesorders.list.view", "challans.manage.create", "purchasebills.manage.create" },
                ["accounts"]       = AccountsKeys,
                ["printtemplates"] = PrintTemplateKeys,
                ["folders"]        = new[] { "folders.list.view", "attachments.list.view", "attachments.manage.upload" },
                ["pendingchallans"]= new[] { "challans.list.view", "bills.manage.create" },
            };

        /// <summary>
        /// Resolve a policy name to its permission-key set. Throws
        /// <see cref="ArgumentException"/> for an unknown name so a typo fails
        /// fast (at request time) instead of silently allowing everything.
        /// </summary>
        public static string[] Resolve(string policyName)
        {
            if (policyName != null && Map.TryGetValue(policyName, out var keys))
                return keys;
            throw new ArgumentException(
                $"Unknown reference-access policy '{policyName}'. " +
                $"Known policies: {string.Join(", ", Map.Keys)}.");
        }
    }
}
