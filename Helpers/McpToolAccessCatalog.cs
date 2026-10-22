namespace MyApp.Api.Helpers;

/// <param name="Permissions">The screen keys behind the tool; holding any one opens it (all, when <paramref name="RequireAll"/>).</param>
/// <param name="Configurable">False for the connection tools every MCP user has.</param>
public sealed record McpToolAccessDefinition(
    string Name, string Group, string Label, string[] Permissions,
    string Scope = "read", bool Write = false, bool SeedOnly = false, bool Configurable = true, bool RequireAll = false);

/// <summary>
/// The ONE list of importer MCP tools: what each needs (screen permission, token scope, write
/// opt-in) and how the per-user catalog groups it. Named MCP grants supplement, never replace,
/// business permissions and token limits. The controller refuses to run a tool missing here.
/// </summary>
public static class McpToolAccessCatalog
{
    private static readonly string[] ClientPickers = { "clients.manage.view", "bills.manage.create", "bills.manage.create.standalone", "challans.manage.create", "salesquotes.manage.create", "salesorders.manage.create", "accounting.receipts.create" };
    private static readonly string[] SupplierPickers = { "suppliers.manage.view", "purchasebills.manage.create", "goodsreceipts.manage.create", "accounting.payments.create" };
    private static readonly string[] ItemPickers = { "itemtypes.manage.view", "bills.manage.create", "bills.manage.create.standalone", "challans.manage.create", "salesquotes.manage.create", "salesorders.manage.create", "purchasebills.manage.create", "goodsreceipts.manage.create", "stock.opening.manage", "importcosting.sheet.run" };
    public static readonly string[] DocumentPrintPermissions =
    {
        "challans.print.view", "bills.print.view", "invoices.print.view", "salesquotes.print.view",
        "salesorders.print.view", "purchasebills.print.view", "goodsreceipts.print.view",
        "accounting.receipts.print", "accounting.payments.print",
    };

    public static IReadOnlyList<McpToolAccessDefinition> All { get; } = Array.AsReadOnly(new McpToolAccessDefinition[]
    {
        new("list_companies", "Connection", "List accessible companies", Array.Empty<string>(), Configurable: false),
        new("get_mcp_capabilities", "Connection", "Show effective AI access", Array.Empty<string>(), Configurable: false),
        new("get_action_status", "Connection", "Check an action outcome", Array.Empty<string>(), Configurable: false),
        new("commit_action", "Connection", "Commit an approved action", Array.Empty<string>(), Write: true, Configurable: false),
        new("cancel_action", "Connection", "Cancel a prepared action", Array.Empty<string>(), Write: true, Configurable: false),

        new("search_clients", "Customers", "Find customers", ClientPickers),
        new("prepare_client", "Customers", "Prepare customer creation or changes", new[] { "clients.manage.create", "clients.manage.update" }, McpScopes.Clients, Write: true),
        new("search_suppliers", "Suppliers", "Find suppliers", SupplierPickers),
        new("prepare_supplier", "Suppliers", "Prepare supplier creation or changes", new[] { "suppliers.manage.create", "suppliers.manage.update" }, McpScopes.Suppliers, Write: true),
        new("search_item_types", "Items", "Find items (with this company's own names)", ItemPickers),
        new("prepare_item_type", "Items", "Prepare item creation or changes", new[] { "itemtypes.manage.create", "itemtypes.manage.update" }, McpScopes.ItemTypes, Write: true),
        new("item_rate_history", "Items", "Read item rate history", new[] { "itemratehistory.view" }),

        new("search_quotes", "Sales", "Find quotations", new[] { "salesquotes.list.view" }),
        new("get_quote", "Sales", "Read a quotation", new[] { "salesquotes.list.view" }),
        new("prepare_quote", "Sales", "Prepare a quotation", new[] { "salesquotes.manage.create", "salesquotes.manage.update" }, McpScopes.Quotes, Write: true),
        new("search_sales_orders", "Sales", "Find sales orders", new[] { "salesorders.list.view" }),
        new("get_sales_order", "Sales", "Read a sales order", new[] { "salesorders.list.view" }),
        new("prepare_sales_order", "Sales", "Prepare a sales order", new[] { "salesorders.manage.create", "salesorders.manage.update" }, McpScopes.Orders, Write: true),
        new("search_challans", "Sales", "Find delivery challans", new[] { "challans.list.view" }),
        new("get_challan", "Sales", "Read a delivery challan", new[] { "challans.list.view" }),
        new("prepare_challan", "Sales", "Prepare a delivery challan (or deliver a sales order)", new[] { "challans.manage.create", "challans.manage.update" }, McpScopes.Challans, Write: true),
        new("search_invoices", "Sales", "Find bills", new[] { "bills.list.view", "invoices.list.view" }),
        new("get_invoice", "Sales", "Read a bill", new[] { "bills.list.view", "invoices.list.view" }),
        new("prepare_bill", "Sales", "Prepare a bill", new[] { "bills.manage.create", "bills.manage.create.standalone", "bills.manage.update" }, McpScopes.Bills, Write: true),
        new("validate_bill_fbr", "Sales", "Validate a bill with FBR (never submits)", new[] { "invoices.fbr.validate" }, McpScopes.FbrValidate),

        new("search_purchase_bills", "Purchases", "Find purchase bills", new[] { "purchasebills.list.view" }),
        new("get_purchase_bill", "Purchases", "Read a purchase bill", new[] { "purchasebills.list.view" }),
        new("prepare_purchase_bill", "Purchases", "Prepare a purchase bill", new[] { "purchasebills.manage.create", "purchasebills.manage.update" }, McpScopes.Purchases, Write: true),
        new("search_goods_receipts", "Purchases", "Find goods receipts", new[] { "goodsreceipts.list.view" }),
        new("prepare_goods_receipt", "Purchases", "Prepare a goods receipt", new[] { "goodsreceipts.manage.create", "goodsreceipts.manage.update" }, McpScopes.Purchases, Write: true),

        new("search_receipts", "Receipts and payments", "Find customer receipts", new[] { "accounting.receipts.view" }),
        new("prepare_receipt", "Receipts and payments", "Prepare a customer receipt", new[] { "accounting.receipts.create" }, McpScopes.Receipts, Write: true),
        new("search_payments", "Receipts and payments", "Find supplier payments", new[] { "accounting.payments.view" }),
        new("prepare_supplier_payment", "Receipts and payments", "Prepare a supplier payment", new[] { "accounting.payments.create" }, McpScopes.Payments, Write: true),

        new("search_gds", "Import costing", "Find GDs (import consignments)", new[] { "importcosting.consignments.view" }),
        new("get_gd", "Import costing", "Read a GD with its lines and charges", new[] { "importcosting.consignments.view" }),
        new("prepare_gd_costing", "Import costing", "Prepare a hand-entered GD costing", new[] { "importcosting.sheet.run" }, McpScopes.Gds, Write: true),
        new("prepare_gd_charge", "Import costing", "Prepare adding or removing a GD charge", new[] { "importcosting.sheet.run" }, McpScopes.Gds, Write: true),
        new("prepare_gd_line_correction", "Import costing", "Prepare a correction to one GD line", new[] { "importcosting.sheet.run" }, McpScopes.Gds, Write: true),
        new("prepare_gd_claim_month", "Import costing", "Prepare a GD or GD line claim month", new[] { "stock.opening.manage" }, McpScopes.Gds, Write: true),
        new("search_lcs", "Import costing", "Find letters of credit", new[] { "importcosting.lc.view" }),
        new("prepare_lc", "Import costing", "Prepare a letter of credit or a GD link", new[] { "importcosting.lc.manage" }, McpScopes.Lcs, Write: true),
        new("get_gd_register", "Import costing", "Read the GD register", new[] { "importcosting.taxdesk.view" }),
        new("get_input_tax_worksheet", "Import costing", "Read the input-tax worksheet", new[] { "importcosting.taxdesk.view" }),

        new("get_stock", "Stock", "Read stock quantities", new[] { "stock.dashboard.view" }),
        new("get_opening_stock", "Stock", "Read opening balances", new[] { "stock.opening.manage" }),
        new("prepare_opening_stock", "Stock", "Prepare an opening balance", new[] { "stock.opening.manage" }, McpScopes.Stock, Write: true),
        new("get_stock_values", "Stock", "Read stock on hand with values", new[] { "stock.dashboard.view" }),
        new("get_stock_movements", "Stock", "Read stock movements", new[] { "stock.movements.view" }),
        new("get_stock_gd_details", "Stock", "Read an item's GD pools", new[] { "stock.dashboard.view" }),
        new("get_stock_tie_out", "Stock", "Read the month-end stock tie-out", new[] { "importcosting.taxdesk.view" }),
        new("prepare_stock_adjustment", "Stock", "Prepare a stock adjustment", new[] { "stock.adjust.create" }, McpScopes.Stock, Write: true),
        new("search_withholding_receipts", "Receipts and payments", "Find withholding tax receipts", new[] { "withholdingtax.list.view" }),
        new("get_withholding_receipt", "Receipts and payments", "Read a withholding tax receipt", new[] { "withholdingtax.list.view" }),
        new("prepare_withholding_receipt", "Receipts and payments", "Prepare a withholding tax receipt", new[] { "withholdingtax.manage.create", "withholdingtax.manage.update" }, McpScopes.Receipts, Write: true),
        new("prepare_receipt_allocation", "Receipts and payments", "Prepare allocating received money to bills", new[] { "accounting.receipts.create" }, McpScopes.Receipts, Write: true),
        new("get_receipt", "Receipts and payments", "Read a customer receipt", new[] { "accounting.receipts.view" }),
        new("get_payment", "Receipts and payments", "Read a supplier payment", new[] { "accounting.payments.view" }),
        new("get_goods_receipt", "Purchases", "Read a goods receipt", new[] { "goodsreceipts.list.view" }),
        new("get_journal_entry", "Accounting", "Read a journal entry", new[] { "accounting.journal.view" }),
        new("find_late_gd_value_fixes", "Stock", "Find items valued wrong by a late GD", new[] { "stock.policy.manage" }),
        new("prepare_late_gd_value_fix", "Stock", "Prepare the late GD value fix", new[] { "stock.policy.manage" }, McpScopes.Stock, Write: true),

        new("sales_summary", "Reports", "Read filed sales totals", new[] { "reports.sales.view" }),
        new("tax_sheet_summary", "Reports", "Read tax sheet totals", new[] { "reports.taxsheet.view" }),
        new("get_customer_balances", "Accounting", "Read customer balances", new[] { "accounting.reports.view" }),
        new("get_supplier_balances", "Accounting", "Read supplier balances", new[] { "accounting.reports.view" }),
        new("get_trial_balance", "Accounting", "Read the trial balance", new[] { "accounting.reports.view" }),
        new("get_profit_and_loss", "Accounting", "Read profit and loss", new[] { "accounting.reports.view" }),
        new("get_balance_sheet", "Accounting", "Read the balance sheet", new[] { "accounting.reports.view" }),
        new("get_cash_book", "Accounting", "Read the cash book", new[] { "accounting.reports.view" }),
        new("get_aged_payables", "Accounting", "Read supplier ageing", new[] { "accounting.reports.view" }),
        new("get_party_ledger", "Accounting", "Read a customer or supplier ledger", new[] { "accounting.reports.view" }),
        new("search_accounts", "Accounting", "Find ledger accounts", new[] { "accounting.coa.view", "accounting.journal.create" }),
        new("prepare_journal_entry", "Accounting", "Prepare a manual journal entry", new[] { "accounting.journal.create" }, McpScopes.Journal, Write: true),

        new("list_print_templates", "Print templates", "List print designs", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_print_template", "Print templates", "Read print design content", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_print_contract", "Print templates", "Read supported print fields", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_document_print_data", "Print templates", "Read actual document print data", DocumentPrintPermissions, McpScopes.DocumentsRead),
    });

    public static McpToolAccessDefinition? Find(string name) =>
        All.FirstOrDefault(tool => string.Equals(tool.Name, name, StringComparison.Ordinal));
}
