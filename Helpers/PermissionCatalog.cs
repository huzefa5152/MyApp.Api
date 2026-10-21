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
            new("dashboard.view",                "Overview Dashboard", "Overview",          "Open", "Access the Dashboard page"),
            new("dashboard.kpi.sales.view",      "Overview Dashboard", "Sales figures",     "See", "See sales KPIs (Total Sales, top clients, recent invoices, sales trend)"),
            new("dashboard.kpi.purchases.view",  "Overview Dashboard", "Purchase figures",  "See", "See purchase KPIs (Total Purchases, top suppliers, recent purchase bills, purchase trend)"),
            new("dashboard.kpi.fbr.view",        "Overview Dashboard", "FBR figures",       "See", "See FBR / compliance KPIs (pending submission, validated, submitted, failed)"),
            new("dashboard.kpi.inventory.view",  "Overview Dashboard", "Stock figures", "See", "See inventory KPIs (stock value, low-stock items, recent stock movements, top items by movement)"),

            // ── RBAC (role & permission administration) ─────────────────────
            new("rbac.roles.view",         "Roles & Permissions", "Roles",        "See",   "View the list of roles and their assigned permissions"),
            new("rbac.roles.create",       "Roles & Permissions", "Roles",        "Add", "Create new roles"),
            new("rbac.roles.update",       "Roles & Permissions", "Roles",        "Edit", "Rename a role or change which permissions it grants"),
            new("rbac.roles.delete",       "Roles & Permissions", "Roles",        "Delete", "Delete a non-system role"),
            new("rbac.permissions.view",   "Roles & Permissions", "Permission list",  "See",   "View the catalog of available permissions"),
            new("rbac.userroles.view",     "Roles & Permissions", "User roles",    "See",   "View which roles are assigned to each user"),
            new("rbac.userroles.assign",   "Roles & Permissions", "User roles",    "Assign", "Assign or unassign roles on a user"),

            // ── Users ───────────────────────────────────────────────────────
            new("users.manage.view",       "Users", "Users", "See list",   "View the users list and user details"),
            new("users.manage.create",     "Users", "Users", "Add", "Create new users"),
            new("users.manage.update",     "Users", "Users", "Edit", "Edit existing users"),
            new("users.manage.delete",     "Users", "Users", "Delete", "Delete users"),

            // ── Companies ───────────────────────────────────────────────────
            new("companies.manage.view",   "Companies", "Companies", "See list",   "View the companies list"),
            new("companies.manage.create", "Companies", "Companies", "Add", "Create a new company"),
            new("companies.manage.update", "Companies", "Companies", "Edit", "Edit company details"),
            new("companies.manage.delete", "Companies", "Companies", "Delete", "Delete a company"),
            // Audit H-16 (2026-05-13): writing Company.FbrToken needs its
            // own gate. Generic companies.manage.update should not be
            // enough to install / rotate a tenant's PRAL bearer.
            new("companies.manage.fbrtoken",  "Companies", "Companies", "Change FBR token",
                "Set or rotate the FBR/PRAL bearer token for a company"),

            // ── Divisions (per-company sub-brands / "sub-companies") ─────────
            // A division carries its own branding (logo / brand / address) and
            // its own Sales Quote numbering, managed from the Configuration →
            // Divisions page. Dedicated keys (not companies.manage.*) so a role
            // can be allowed to manage divisions without full company-edit rights.
            new("divisions.manage.view",   "Divisions", "Divisions", "See list",   "View the divisions list"),
            new("divisions.manage.create", "Divisions", "Divisions", "Add", "Create a new division"),
            new("divisions.manage.update", "Divisions", "Divisions", "Edit", "Edit a division and upload its logo"),
            new("divisions.manage.delete", "Divisions", "Divisions", "Delete", "Delete a division (referencing quotes/templates fall back to company-level)"),

            // ── Clients ─────────────────────────────────────────────────────
            new("clients.manage.view",     "Clients", "Clients", "See list",   "View the clients list"),
            new("clients.manage.create",   "Clients", "Clients", "Add", "Create a new client"),
            new("clients.manage.update",   "Clients", "Clients", "Edit", "Edit client details"),
            new("clients.manage.delete",   "Clients", "Clients", "Delete", "Delete a client"),
            // Copy an existing client into one or more other companies. The
            // copy is auto-linked to the same Common Client group via NTN /
            // normalised-name matching, so subsequent Common Client edits
            // cascade across all members. Kept separate from .create so a
            // role can be allowed to populate new tenants from existing
            // clients without bare create-from-scratch rights.
            new("clients.manage.copy",     "Clients", "Clients", "Copy to another company",   "Copy an existing client into another company"),
            new("customerledger.opening.manage", "Clients", "Opening balance", "Enter / edit", "Enter or correct a customer's opening balance"),

            // ── Customer Portal ─────────────────────────────────────────────
            // A portal is a public, password-less link that shows ONE client
            // their own invoices. The link's token is the entire access
            // control, so `list.view` is not an innocent read: whoever holds it
            // can copy a URL that hands a stranger a client's financials.
            // Treat it like a credential when assigning roles.
            new("customerportal.list.view",     "Customer Portal", "Customer Portal",   "See list",   "View customer portals and copy their public links (the link grants access to that client's invoices)"),
            new("customerportal.manage.create", "Customer Portal", "Customer Portal", "Add", "Create a public customer portal for a client"),
            new("customerportal.manage.update", "Customer Portal", "Customer Portal", "Edit", "Enable or disable a customer portal"),
            new("customerportal.manage.delete", "Customer Portal", "Customer Portal", "Delete", "Revoke a customer portal permanently (its link stops working for good)"),

            // ── Delivery Challans ───────────────────────────────────────────
            new("challans.list.view",      "Delivery Challans", "Delivery Challans",   "See list",   "View the delivery-challan list"),
            new("challans.manage.create",     "Delivery Challans", "Delivery Challans", "Add",    "Create a new delivery challan"),
            new("challans.manage.update",     "Delivery Challans", "Delivery Challans", "Edit",    "Edit a delivery challan"),
            new("challans.manage.delete",     "Delivery Challans", "Delivery Challans", "Delete",    "Delete a delivery challan"),
            // 2026-05-08: separate permission for the Duplicate action so an
            // operator role can be allowed to spawn billable copies without
            // also being granted full create-from-scratch rights, or vice-versa.
            // Server-side gate is in DeliveryChallansController.Duplicate;
            // frontend hides the button when missing.
            new("challans.manage.duplicate",  "Delivery Challans", "Delivery Challans", "Duplicate", "Duplicate a delivery challan (clone with the same number for a different PO)"),
            new("challans.import.create",  "Delivery Challans", "Delivery Challans", "Import from customer PO", "Import challans from an Excel template"),
            new("challans.print.view",     "Delivery Challans", "Delivery Challans",  "Print / PDF",   "Print or download challans"),

            // ── Sales Quotes (priced pre-sale quotation) ────────────────────
            // Pre-sale documents — NOT FBR documents. A quote answers a
            // customer enquiry with prices; it can be converted into a Sales
            // Order (which then drives delivery challans).
            new("salesquotes.list.view",     "Sales Quotes", "Sales Quotes",   "See list",   "View the sales-quotes list"),
            new("salesquotes.manage.create", "Sales Quotes", "Sales Quotes", "Add", "Create a sales quote"),
            new("salesquotes.manage.update", "Sales Quotes", "Sales Quotes", "Edit", "Edit a sales quote and change its status"),
            new("salesquotes.manage.delete", "Sales Quotes", "Sales Quotes", "Delete", "Delete a sales quote"),
            new("salesquotes.print.view",    "Sales Quotes", "Sales Quotes",  "Print / PDF",   "Print or download a sales quote"),

            // ── Sales Orders (quantity-only confirmed order) ────────────────
            // The internal representation of a customer PO. Delivery challans
            // are raised against an order to track fulfilment. Converting a
            // quote or importing a PO both create a Sales Order, so those
            // actions are gated by salesorders.manage.create. Raising a challan
            // from an order reuses challans.manage.create.
            new("salesorders.list.view",     "Sales Orders", "Sales Orders",   "See list",   "View the sales-orders list"),
            new("salesorders.manage.create", "Sales Orders", "Sales Orders", "Add", "Create a sales order (incl. converting a quote or importing a PO)"),
            new("salesorders.manage.update", "Sales Orders", "Sales Orders", "Edit", "Edit a sales order and change its status"),
            new("salesorders.manage.delete", "Sales Orders", "Sales Orders", "Delete", "Delete a sales order"),
            new("salesorders.print.view",    "Sales Orders", "Sales Orders",  "Print / PDF",   "Print or download a sales order"),

            // ── Withholding Tax Receipts (customer-issued tax certificates) ──
            // Records tax a customer withheld at source (and remitted on our
            // behalf). The per-customer sum is the "Withholding tax receivable"
            // figure on the Customers screen. NOT an FBR document. The read
            // permission also gates the print/view of a single receipt.
            new("withholdingtax.list.view",     "Withholding Tax", "Withholding Tax",   "See list",   "View the withholding-tax-receipts list and a single receipt"),
            new("withholdingtax.manage.create", "Withholding Tax", "Withholding Tax", "Add", "Record a withholding tax receipt"),
            new("withholdingtax.manage.update", "Withholding Tax", "Withholding Tax", "Edit", "Edit a withholding tax receipt"),
            new("withholdingtax.manage.delete", "Withholding Tax", "Withholding Tax", "Delete", "Delete a withholding tax receipt"),
            new("withholdingtax.print.view",    "Withholding Tax", "Withholding Tax",  "Print / PDF",   "Print or download a withholding tax receipt"),

            // ── Accounting: Receipts & Payments (AR/AP subledger) ───────────
            // Money in (receipts → settle sales invoices) and money out
            // (payments → settle purchase bills). Split namespaces so a role can
            // record receipts WITHOUT being able to pay money out (separation of
            // duties). These produce invoice/bill balance-due + payment status.
            new("accounting.receipts.view",   "Receipts", "Receipts", "See",   "View receipts (money in) and an invoice's settled payments"),
            new("accounting.receipts.create", "Receipts", "Receipts", "Add", "Record money in — settle sales invoices, other income, or a customer advance"),
            new("accounting.receipts.delete", "Receipts", "Receipts", "Delete", "Delete a receipt"),
            new("accounting.receipts.print",  "Receipts", "Receipts", "Print / PDF",  "Print or download a receipt voucher"),
            new("accounting.payments.view",   "Payments", "Payments", "See",   "View payments (money out) and a bill's settled payments"),
            new("accounting.payments.create", "Payments", "Payments", "Add", "Record money out — settle purchase bills, an expense, or a supplier advance"),
            new("accounting.payments.delete", "Payments", "Payments", "Delete", "Delete a payment"),
            new("accounting.payments.print",  "Payments", "Payments", "Print / PDF",  "Print or download a payment voucher"),

            // Customer Ledger — derived money in/out trail per customer
            // (ICustomerLedgerService). Separate module from "Accounting" so it
            // gets its own navbar-section mapping entry, but it lives in the
            // same Accounting section next to Receipts/Payments.
            new("customerledger.list.view",  "Customer Ledger", "Customer ledger", "See",  "View every customer's balance and their full money in/out ledger"),
            new("customerledger.list.print", "Customer Ledger", "Customer ledger", "Print / PDF", "Print or download a customer statement"),
            new("spreadsheetimport.ledger.run",      "Customer Ledger", "Import from workbook", "Import", "Import a customer outstanding ledger workbook into a company"),

            // Chart of Accounts (the account tree postings land on). View to read
            // the tree; manage to add/edit/delete groups & accounts and seed a
            // sector preset. Control accounts can't be deleted (subledger-backed).
            new("accounting.coa.view",   "Chart of Accounts", "Chart of accounts", "See",   "View the chart of accounts"),
            new("accounting.coa.manage", "Chart of Accounts", "Chart of accounts", "Add / edit accounts", "Add/edit/delete accounts & groups and seed a sector preset"),
            new("accounting.gl.manage",       "Chart of Accounts", "Ledger setup", "Turn on / rebuild the ledger", "Enable GL posting, run backfill/rebuild and set the lock date"),

            // General Ledger (Phase B). journal.* = manual journal entries
            // (system-posted entries are read-only); transfers.* = inter-account
            // bank/cash movements; gl.manage = enable/backfill/rebuild + lock
            // date (period close) — an admin-grade switch, deliberately separate
            // from coa.manage; reports/dashboard are read-only surfaces.
            new("accounting.journal.view",    "Journal Entries", "Journal Entries", "See",   "View journal entries (manual and system-posted)"),
            new("accounting.journal.create",  "Journal Entries", "Journal Entries", "Add", "Create and edit manual journal entries"),
            new("accounting.journal.delete",  "Journal Entries", "Journal Entries", "Delete", "Delete manual journal entries"),
            new("accounting.journal.print",   "Journal Entries", "Journal Entries", "Print / PDF",  "Print or download a journal voucher"),
            new("accounting.transfers.view",   "Transfers", "Transfers", "See",   "View inter-account (bank/cash) transfers"),
            new("accounting.transfers.create", "Transfers", "Transfers", "Add", "Record and edit inter-account transfers"),
            new("accounting.transfers.delete", "Transfers", "Transfers", "Delete", "Delete inter-account transfers"),
            new("accounting.transfers.print",  "Transfers", "Transfers", "Print / PDF",  "Print or download a transfer advice"),
            new("accounting.reconciliation.view",   "Bank & Cash Accounts", "Bank reconciliation", "See",   "View bank/cash account balances and reconciliation status"),
            new("accounting.reconciliation.manage", "Bank & Cash Accounts", "Bank reconciliation", "Reconcile", "Mark transactions cleared and reconcile a bank statement"),
            new("accounting.dashboard.view",  "Accounting Dashboard", "Accounting dashboard", "Open", "View the accounting summary dashboard"),

            // Legacy data migration (admin/ops). Also gated by a non-Production
            // environment + the LegacyDb connection string — never reachable in prod.
            new("accounting.import.run", "Data Migration", "Data migration", "Run data migration", "Run the legacy Data_2021 ETL into a company (non-prod only)"),
            new("accounting.import.manager", "Data Migration", "Data migration", "Run Manager.io import", "Import a Manager.io business export (.zip of JSON) into a company — works on the live server"),

            // ── Spreadsheet import (opening stock + customer ledger) ─────────
            // Its own module, NOT accounting.import.*: those keys sit behind a
            // non-Production gate (LegacyImportController) and this importer has
            // to run against a live tenant during onboarding.
            //
            // reimport.force is separated on purpose. Every other key here can
            // only ADD data the operator has reviewed; force is the one path
            // that sets aside a completed import so the same file can be loaded
            // over the top of it.
            new("spreadsheetimport.profiles.view",   "Spreadsheet Import", "Sheet layouts", "See",   "View saved spreadsheet layouts and their mapping history"),
            new("spreadsheetimport.profiles.manage", "Spreadsheet Import", "Sheet layouts", "Add / edit", "Save, edit and roll back a spreadsheet layout mapping"),
            new("spreadsheetimport.runs.view",       "Spreadsheet Import", "Import history", "See",  "View what has been imported into a company, and when"),
            new("spreadsheetimport.reimport.force",  "Spreadsheet Import", "Import history", "Re-import the same file", "Set aside a completed import so the same file can be imported again"),

            // ── Folders + Attachments (unified document management) ─────────
            // One shared system powers the Configuration → Folders library AND
            // the reusable attachment component on transaction modules. Folders
            // are per-company; an attachment may sit in a folder and/or be
            // linked to a business document (SalesQuote, Invoice, …). Download
            // is gated by attachments.list.view — if you can list it, you can
            // download it.
            new("folders.list.view",          "Folders & Attachments",     "Folders",   "See",   "View folders and their contents"),
            new("folders.manage.create",      "Folders & Attachments",     "Folders", "Add", "Create a folder"),
            new("folders.manage.update",      "Folders & Attachments",     "Folders", "Edit", "Rename a folder"),
            new("folders.manage.delete",      "Folders & Attachments",     "Folders", "Delete", "Delete a folder (folder-only documents are removed)"),
            new("attachments.list.view",      "Folders & Attachments", "Attachments",   "See",   "View and download attachments"),
            new("attachments.manage.upload",  "Folders & Attachments", "Attachments", "Upload", "Upload an attachment"),
            new("attachments.manage.delete",  "Folders & Attachments", "Attachments", "Delete", "Delete an attachment"),

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
            new("bills.list.view",          "Bills", "Bills",   "See list",   "View the bills list (powers both Bills and Invoices tabs)"),
            new("bills.manage.create",      "Bills", "Bills", "Add from challan", "Create a new bill (challan-linked)"),
            // Standalone create — operator can issue a bill WITHOUT a linked
            // delivery challan. Carved out as a separate permission so a role
            // can be granted ONLY this without also gaining the regular
            // create-from-challan flow, or vice-versa.
            new("bills.manage.create.standalone", "Bills", "Bills", "Add without challan", "Create a bill directly without linking a delivery challan"),
            new("bills.manage.update",      "Bills", "Bills", "Edit", "Edit a bill (all fields)"),
            new("bills.manage.delete",      "Bills", "Bills", "Delete", "Delete a bill"),
            // Void is a distinct, less-destructive sibling of Delete: it keeps
            // the bill (and its number, so the sequence stays gap-free) but
            // marks it Cancelled and frees its challan(s) for re-billing.
            // Separate key so a role can be allowed to void without also being
            // trusted to hard-delete the trailing bill.
            new("bills.manage.void",        "Bills", "Bills", "Void",   "Void (cancel) a non-submitted bill — keeps the number gap-free and reverts its delivery challan(s) to Pending"),
            new("bills.print.view",         "Bills", "Bills",  "Print / PDF",   "Print or download a Bill (Bill print, Bill PDF, Bill XLS)"),

            // ── Invoices (FBR classification + submission) ──────────────────
            new("invoices.list.view",      "Invoices", "Invoices",   "See list",   "View the Invoices tab (FBR submission view of bills)"),
            // Narrow edit permissions live under Invoices because item-type
            // classification is the Invoices tab's responsibility — a Bills-
            // only user (bookkeeper) doesn't need to set ItemType. The
            // bookkeeping fields (price, dates, descriptions) stay locked
            // when these are the user's only update perm; only Item Type
            // (and optionally Qty) become editable.
            new("invoices.manage.update.itemtype",     "Invoices", "Invoices", "Change item type",       "Edit ONLY the Item Type column on a bill from the Invoices tab"),
            new("invoices.manage.update.itemtype.qty", "Invoices", "Invoices", "Change item type and quantity", "Edit Item Type and Quantity columns on a bill from the Invoices tab"),
            // Reverse an FBR-submitted invoice → auto-generate a Credit Note
            // (return/reversal) or Debit Note (upward correction). The note is
            // created unsubmitted so it can be validated then submitted like an
            // ordinary bill. Distinct from create/void so the right to reverse a
            // filed document is granted independently.
            new("invoices.note.create",    "Invoices", "Invoices", "Make a credit / debit note", "Reverse an FBR-submitted bill by generating a Credit/Debit Note (created unsubmitted, then validated + submitted to FBR)"),
            // Two granular FBR permissions — separating dry-run from real
            // submission so an operator can be allowed to validate without
            // being trusted to commit. A user with .submit but not .validate
            // would never get to use the validate button, so most roles will
            // get both. Granting .validate alone is the useful asymmetric case
            // (junior operator preparing bills, senior reviewer submits).
            new("invoices.fbr.validate",   "Invoices", "FBR filing",    "Check with FBR", "Dry-run validate a bill with FBR (no commit, no IRN issued)"),
            new("invoices.fbr.submit",     "Invoices", "FBR filing",    "Submit to FBR",   "Submit a bill to FBR digital invoicing (commits, returns IRN)"),
            // View the JSON we would POST to FBR — grouped items, totals,
            // tax breakdown — without sending anything. Useful for review
            // / sign-off before clicking the real Validate / Submit button.
            new("invoices.fbr.preview",    "Invoices", "FBR filing",    "Preview what is sent",  "View the FBR submission preview (grouped items, totals, raw JSON) without sending to FBR"),
            // Independent permission for the per-bill "Exclude from FBR /
            // Include in FBR" toggle. Excluded bills are skipped by Validate
            // All / Submit All. Carved out of bills.manage.update so an
            // operator can be trusted to flip the toggle without being trusted
            // to edit prices, dates, or items on the bill itself.
            new("invoices.fbr.exclude",    "Invoices", "FBR filing",    "Keep a bill out of FBR", "Mark a bill as excluded from FBR bulk Validate/Submit, or re-include it"),
            // Admin recovery for a bill locked after a timed-out / crashed submit
            // ("Uncertain" / "Submitting"). Lets a trusted user clear the FBR state
            // for resubmission, or record an IRN they confirmed at FBR — the ONLY
            // sanctioned way to unlock the double-submit guard. High-trust: it can
            // clear a real IRN, so keep it to admins / senior FBR officers.
            new("invoices.fbr.reset",      "Invoices", "FBR filing",    "Reset a stuck submission", "Reset a bill's FBR submission state (clear for resubmit, or record a confirmed IRN) after a timed-out/uncertain submit"),
            new("invoices.print.view",     "Invoices", "Invoices",  "Print / PDF",   "Print or download a Tax Invoice (Tax Invoice print, Tax PDF, Tax XLS)"),

            // ── PO Formats (Purchase-Order parser registry) ─────────────────
            new("poformats.manage.view",   "PO Formats", "PO Formats", "See list",   "View registered PO formats"),
            new("poformats.manage.create", "PO Formats", "PO Formats", "Add", "Register a new PO format"),
            new("poformats.manage.update", "PO Formats", "PO Formats", "Edit", "Edit a PO format ruleset"),
            new("poformats.manage.delete", "PO Formats", "PO Formats", "Delete", "Delete a PO format"),
            new("poformats.import.create",      "PO Formats", "Import a PO",        "Import", "Upload a PO file and import its parsed items"),
            new("poformats.import.viewArchive", "PO Formats", "Imported PO archive", "See",   "List archived PO PDFs (with parse outcome) and download originals for triage"),

            // ── Import Feedback (parser-accuracy feedback on document imports) ─
            new("importfeedback.manage.create", "Import Feedback", "Send feedback", "Send",   "Record on the import Review screen whether a PO parsed correctly"),
            new("importfeedback.list.view",     "Import Feedback", "Review", "See",     "List imports flagged as incorrectly parsed and view accuracy statistics"),
            new("importfeedback.download.view", "Import Feedback", "Review", "Download", "Download the original PDF(s) of flagged imports (single or ZIP)"),

            // ── FBR Purchase Import (Annexure-A xls upload) ─────────────────
            new("fbrimport.purchase.preview", "FBR Purchase Import", "Import purchases from FBR", "Preview", "Upload an FBR Annexure-A xls and view the per-row import preview (no writes)"),
            new("fbrimport.purchase.commit",  "FBR Purchase Import", "Import purchases from FBR", "Save",  "Commit an FBR Annexure-A import — auto-creates Suppliers, Purchase Bills, Item Types, and Stock Movements"),

            // ── Print Templates ─────────────────────────────────────────────
            new("printtemplates.manage.view",     "Print Templates", "Templates", "See",          "View print/merge templates"),
            new("printtemplates.manage.update",   "Print Templates", "Templates", "Edit",        "Edit a print template"),
            // Pin the Excel data sheet for import — separate from the broader
            // template-edit perm so a role can be allowed to fix the sheet
            // pin (a low-risk, recoverable change) without also gaining
            // rights to re-upload or edit template bodies.
            new("printtemplates.manage.sheetpin", "Print Templates", "Templates", "Pin data sheet","Pin which Excel sheet the importer reads from a multi-sheet template"),
            new("printtemplates.manage.delete",   "Print Templates", "Templates", "Delete",        "Delete a saved print template"),
            new("printtemplates.starter.apply",   "Print Templates", "Templates", "Apply a starter design", "Apply a starter design onto an existing template (replace its HTML or its whole layout)"),
            new("printtemplates.stamps.view",     "Print Templates", "Stamps", "See",          "View company stamps/signatures"),
            new("printtemplates.stamps.manage",   "Print Templates", "Stamps", "Add / edit",        "Upload, rename, reorder and delete company stamps used as print-template merge fields"),
            new("config.mergefields.manage",      "Print Templates", "Merge fields",      "Add / edit", "Manage mergeable template fields"),

            // ── FBR Configuration ───────────────────────────────────────────
            new("fbr.config.view",         "FBR", "FBR settings", "See",   "View FBR configuration and credentials"),
            new("fbr.config.update",       "FBR", "FBR settings", "Edit", "Edit FBR configuration and credentials"),
            new("fbr.lookup.view",         "FBR", "Lookups", "See",   "View FBR lookup tables (provinces, HS codes, etc.)"),
            // Audit M-9 (2026-05-13): explicit gate for the public-ish
            // FBR reference-data endpoints (HS codes, UOMs, provinces).
            // Without this an idle tenant member could otherwise burn the
            // company's PRAL daily quota.
            new("fbr.reference.read",         "FBR", "Reference data", "See",
                "Read FBR reference catalogs (HS codes, UOMs, provinces, sale types)"),

            // ── FBR Sandbox (scenario test bills, isolated 900000+ numbering) ─
            new("fbr.sandbox.view",        "FBR", "Sandbox", "See",   "View the FBR Sandbox tab and demo scenario bills"),
            new("fbr.sandbox.seed",        "FBR", "Sandbox", "Set up test data",   "Auto-create demo scenario bills for a company"),
            new("fbr.sandbox.run",         "FBR", "Sandbox", "Run",    "Validate / submit demo scenario bills against PRAL"),
            new("fbr.sandbox.delete",      "FBR", "Sandbox", "Delete", "Delete demo scenario bills and challans"),
            new("fbrmonitor.view",         "FBR",       "Monitor", "See", "View FBR communication trail and aggregate health"),

            // ── Item Types / Descriptions / Units ───────────────────────────
            new("itemtypes.manage.view",   "Item Types", "Item Types", "See list",   "View item types"),
            new("itemtypes.manage.create", "Item Types", "Item Types", "Add", "Create a new item type"),
            new("itemtypes.manage.update", "Item Types", "Item Types", "Edit", "Edit an item type"),
            new("itemtypes.manage.delete", "Item Types", "Item Types", "Delete", "Delete an item type"),

            // ── HS / PCT code master (reference data) ───────────────────────
            // Deliberately its own module rather than part of "FBR": the tariff
            // master is what Item Types are classified against, and it must stay
            // usable by companies that have FBR integration switched OFF. The
            // token key is separate from the import key because it writes a
            // credential (same reasoning as companies.manage.fbrtoken).
            new("hscodes.list.view",   "HS Codes", "HS code list", "See",   "Search the HS / PCT code master and its UOMs"),
            new("hscodes.import.run",  "HS Codes", "HS code list", "Import tariff", "Import / re-sync HS codes from FBR's tariff catalog"),
            new("hscodes.token.manage","HS Codes", "HS code list", "Set FBR reference token",  "Set the installation-wide FBR reference token used to read HS codes"),

            // ── Non-Inventory Items (per-company GL-account shortcut lines) ──
            // Freight / Discount / service-fee line items that post to a mapped
            // income/expense account and move no stock (Manager.io "Non-inventory
            // Items"). Managed from Configuration → Non-Inventory Items; each maps
            // to the company's chart of accounts. NOT an FBR concept.
            new("noninventoryitems.list.view",     "Non-Inventory Items", "Non-Inventory Items",   "See list",   "View the non-inventory items list"),
            new("noninventoryitems.manage.create", "Non-Inventory Items", "Non-Inventory Items", "Add", "Create a non-inventory item (Freight, Discount, …)"),
            new("noninventoryitems.manage.update", "Non-Inventory Items", "Non-Inventory Items", "Edit", "Edit a non-inventory item and its account mapping"),
            new("noninventoryitems.manage.delete", "Non-Inventory Items", "Non-Inventory Items", "Delete", "Delete a non-inventory item (only when unused)"),

            new("config.itemdescriptions.manage", "Units & Descriptions", "Item descriptions", "Add / edit", "Manage the item-description lookup list"),
            new("config.units.manage",            "Units & Descriptions", "Units",            "Add / edit", "Manage the units-of-measure lookup list"),

            // ── Item Rate History (search past rates billed for any item) ───
            new("itemratehistory.view",    "Item Rate History", "Item Rate History", "See", "View the Item Rate History page (past unit prices billed for an item)"),

            // ── Suppliers (mirror of Clients) ───────────────────────────────
            new("suppliers.manage.view",   "Suppliers", "Suppliers", "See list",   "View the suppliers list"),
            new("suppliers.manage.create", "Suppliers", "Suppliers", "Add", "Create a new supplier"),
            new("suppliers.manage.update", "Suppliers", "Suppliers", "Edit", "Edit supplier details"),
            new("suppliers.manage.delete", "Suppliers", "Suppliers", "Delete", "Delete a supplier"),
            // Mirror of clients.manage.copy — same rationale.
            new("suppliers.manage.copy",   "Suppliers", "Suppliers", "Copy to another company",   "Copy an existing supplier into another company"),

            // ── Purchase Bills ──────────────────────────────────────────────
            new("purchasebills.list.view",     "Purchase Bills", "Purchase Bills",   "See list",   "View the purchase-bills list"),
            new("purchasebills.manage.create", "Purchase Bills", "Purchase Bills", "Add", "Create a new purchase bill (records supplier IRN and emits Stock IN)"),
            new("purchasebills.manage.update", "Purchase Bills", "Purchase Bills", "Edit", "Edit a purchase bill"),
            new("purchasebills.manage.delete", "Purchase Bills", "Purchase Bills", "Delete", "Delete a purchase bill (reverses any Stock IN it emitted)"),
            new("purchasebills.print.view",    "Purchase Bills", "Purchase Bills",  "Print / PDF",   "Print or download purchase bills"),
            new("purchasedebitnotes.list.view",     "Purchase Debit Notes", "Purchase Debit Notes",   "See list",   "View the purchase (supplier) debit-notes list and a single note"),
            new("purchasedebitnotes.print.view",    "Purchase Debit Notes", "Purchase Debit Notes",  "Print / PDF",   "Print / export a purchase debit note"),
            new("purchasedebitnotes.manage.create", "Purchase Debit Notes", "Purchase Debit Notes", "Add", "Create a purchase debit note"),
            new("purchasedebitnotes.manage.update", "Purchase Debit Notes", "Purchase Debit Notes", "Edit", "Edit a purchase debit note"),
            new("purchasedebitnotes.manage.delete", "Purchase Debit Notes", "Purchase Debit Notes", "Delete", "Delete a purchase debit note"),

            // ── Goods Receipts (mirror of Delivery Challans on the buy-side) ─
            new("goodsreceipts.list.view",     "Goods Receipts", "Goods Receipts",   "See list",   "View goods-receipt notes"),
            new("goodsreceipts.manage.create", "Goods Receipts", "Goods Receipts", "Add", "Create a goods-receipt note"),
            new("goodsreceipts.manage.update", "Goods Receipts", "Goods Receipts", "Edit", "Edit a goods-receipt note"),
            new("goodsreceipts.manage.delete", "Goods Receipts", "Goods Receipts", "Delete", "Delete a goods-receipt note"),
            new("goodsreceipts.print.view",    "Goods Receipts", "Goods Receipts",  "Print / PDF",   "Print or download goods-receipt notes"),

            // ── Inventory / Stock ───────────────────────────────────────────
            new("stock.dashboard.view",     "Stock", "Stock screen",       "See",   "View on-hand stock dashboard"),
            new("stock.dashboard.export",   "Stock", "Stock screen",       "Download Excel", "Download the stock dashboard as an Excel workbook (movement detail needs Movements ▸ View too)"),
            new("stock.movements.view",     "Stock", "Stock movements",       "See",   "View the stock-movement audit log"),
            new("stock.opening.manage",     "Stock", "Opening stock", "Enter / edit", "Set or edit opening stock balance per item"),
            new("spreadsheetimport.stock.run",       "Stock", "Opening stock", "Import from sheet", "Import an opening stock sheet into a company"),
            new("stock.adjust.create",      "Stock", "Stock adjustments",      "Adjust stock", "Record a stock adjustment (count correction, write-off)"),
            new("stock.policy.manage",      "Stock", "Stock rules",          "Change", "Switch a company's inventory tracking version (V1 legacy ⇄ V2) — reversible, audited"),
            new("stock.overcommit.allow",   "Stock", "Stock rules",     "Sell more than is in stock",  "Override the availability hard-block and knowingly over-commit / oversell stock"),
            // GD (Goods Declaration) costing import writes the actual landed
            // cost onto stock; this gates seeing that cost and its margin
            // wherever stock is displayed (e.g. the Opening Balances tab).
            new("stock.actualcost.view",    "Stock", "Landed cost",     "See landed cost",   "See the actual landed cost of stock and its margin"),

            // ── Import Costing (customs GD costing workbook) ────────────────
            // A GD is a procurement document, so this module sits under the
            // Purchases section in the sidebar/role editor (see
            // permissionSections.js) even though it writes stock.actualcost
            // data that Inventory screens then display.
            new("importcosting.sheet.run",          "Import Costing", "GD costing sheet", "Import",  "Import a GD costing workbook and load actual cost onto stock"),
            new("importcosting.consignments.view",  "Import Costing", "Consignments",     "See", "View imported consignments and their lines"),
            new("importcosting.taxdesk.view",       "Import Costing", "Import Tax Desk",  "See", "View the GD register, the monthly input-tax worksheet and the month-end tie-out"),
            new("importcosting.lc.view",            "Import Costing", "Letters of Credit", "See", "View letters of credit and the GDs shipped against them"),
            new("importcosting.lc.manage",          "Import Costing", "Letters of Credit", "Add / edit", "Record, edit and delete letters of credit, and link GDs and bills of lading to them"),

            // ── Reports ─────────────────────────────────────────────────────
            new("reports.sales.view",       "Reports", "Sales report", "See",   "View the Sales report (FBR-submitted invoices grouped by date, monthly/yearly)"),
            new("reports.sales.export",     "Reports", "Sales report", "Download Excel", "Export the Sales report to CSV/Excel"),
            new("reports.invoicedetail.view", "Reports", "Invoice sales detail", "See", "View monthly invoice lines, buyer details and FBR status"),
            new("reports.invoicedetail.export", "Reports", "Invoice sales detail", "Download Excel", "Export monthly invoice sales detail to Excel"),
            new("reports.taxsheet.view",    "Reports", "Tax sheet", "See",   "View the Tax Sheet (invoice lines still missing a valid HS code, for the tax consultant)"),
            new("reports.taxsheet.export",  "Reports", "Tax sheet", "Download Excel", "Export the Tax Sheet to Excel"),
            // Company-wide customer statements. Distinct from customerledger.* —
            // that module gates the per-customer Accounting screen; these gate
            // the every-customer report in the Reports section.
            new("reports.clientledger.view",   "Reports", "Client ledger", "See",   "View the Client Ledger report (every customer's statement for a period)"),
            new("reports.clientledger.export", "Reports", "Client ledger", "Download Excel", "Export the Client Ledger report to Excel"),
            new("accounting.reports.view",    "Reports", "Accounting reports", "See", "View the accounting reports — expenses, cash & bank, trial balance, AR/AP aging"),
            new("accounting.reports.export",  "Reports", "Accounting reports", "Download Excel", "Download an accounting report as Excel"),

            // ── Audit Logs ──────────────────────────────────────────────────
            new("auditlogs.view",          "Audit Logs", "Audit logs", "See", "View application audit/exception logs"),

            // ── FBR Monitor ─────────────────────────────────────────────────
            // Dedicated trail for every FBR / PRAL HTTP call (request body
            // masked, response body masked, status, retry count, duration).
            // Distinct from auditlogs.view so an "FBR officer" role can see
            // the FBR sync health without unrelated app audit access.

            // ── Tenant Access (User → Company assignments) ──────────────────
            // Decides who can SEE the per-company data. Access is fail-closed:
            // a non-seed-admin reaches a company only via an explicit
            // UserCompanies row that ICompanyAccessGuard checks. The
            // `IsTenantIsolated` flag on Company is now informational and does
            // not change access decisions (the old open mode is gone). These
            // two permissions gate the UI that maintains those rows; flipping
            // IsTenantIsolated itself is gated by tenantaccess.manage.update (below).
            new("tenantaccess.manage.view",   "Tenant Access", "Company access", "See",
                "View user → company tenant-access assignments"),
            new("tenantaccess.manage.assign", "Tenant Access", "Company access", "Assign",
                "Grant or revoke a user's access to specific companies"),
            // Audit H-1 (2026-05-13): flipping Company.IsTenantIsolated
            // changes who passes the access guard for that company. Carve
            // it out from generic companies.manage.update so a regular
            // operator with company-edit rights cannot silently open up a
            // company to every authenticated user.
            new("tenantaccess.manage.update", "Tenant Access", "Company access", "Edit",
                "Toggle Company.IsTenantIsolated (changes who can see a company)"),
            // ── AI agents (hosted MCP) ─────────────────────────────────────
            // Gate for POST /mcp. Each tool still demands the same permission
            // and company access its screen does; these keys only open the door.
            // Premium: only the primary admin may grant them (RolesController /
            // UserRolesController), the Administrator role does not carry them,
            // and they follow the per-user MCP access policy (PermissionService).
            new("mcp.access.use",   "Tenant Access", "AI agents (MCP)", "Use",
                "Connect AI agents (Claude, Codex, ChatGPT) to this system through the hosted MCP endpoint, with the same access this user has"),
            new("mcp.write.use",    "Tenant Access", "AI agents (MCP)", "Make changes",
                "Let connected AI agents prepare records (customers, bills, GDs, receipts ...) that a person approves before they are saved"),
            new("mcp.admin.manage", "Tenant Access", "AI agents (MCP)", "Issue tokens",
                "Create and revoke AI agent tokens for any user and read every agent's activity (primary admin console)"),
            // ── Division Access (user → division assignments) ────────────────
            // The layer below Tenant Access: within a company the user can
            // reach, optionally restrict them to specific divisions
            // (UserCompany.RestrictToDivisions + UserDivision rows, enforced
            // by IDivisionAccessGuard). Separate keys from tenantaccess.* so a
            // company-level admin role can delegate division assignment
            // without the power to open whole companies.
            new("divisionaccess.manage.view",   "Division Access", "Division access", "See",
                "View user → division access assignments"),
            new("divisionaccess.manage.assign", "Division Access", "Division access", "Assign",
                "Restrict a user to specific divisions, or lift the restriction"),
        };
    }
}
