namespace MyApp.Api.Helpers;

public sealed record McpToolAccessDefinition(
    string Name, string Group, string Label, string[] Permissions,
    string Scope = "read", bool Write = false, bool SeedOnly = false, bool Configurable = true, bool RequireAll = false);

/// <summary>Named MCP grants supplement, never replace, business permissions and token limits.</summary>
public static class McpToolAccessCatalog
{
    public static IReadOnlyList<McpToolAccessDefinition> All { get; } = Array.AsReadOnly(new McpToolAccessDefinition[]
    {
        new("list_companies", "Connection", "List accessible companies", Array.Empty<string>(), Configurable: false),
        new("get_mcp_capabilities", "Connection", "Show effective AI access", Array.Empty<string>(), Configurable: false),
        new("get_action_status", "Connection", "Check an action outcome", Array.Empty<string>(), Configurable: false),
        new("commit_action", "Connection", "Commit an approved action", Array.Empty<string>(), Write: true, Configurable: false),
        new("cancel_action", "Connection", "Cancel a prepared action", Array.Empty<string>(), Write: true, Configurable: false),

        new("search_clients", "Customers", "Find customers", new[] { "clients.manage.view" }),
        new("prepare_client", "Customers", "Prepare customer creation or changes", new[] { "clients.manage.create", "clients.manage.update" }, McpScopes.Clients, Write: true),
        new("search_suppliers", "Suppliers", "Find suppliers", new[] { "suppliers.manage.view" }),

        new("search_quotes", "Sales", "Find quotations", new[] { "salesquotes.list.view" }),
        new("search_email_enquiries", "Email enquiries", "Find accessible email enquiries", new[] { "email.workspace.use", "email.inbox.view" }, RequireAll: true),
        new("get_email_enquiry", "Email enquiries", "Read an email enquiry and numbered items", new[] { "email.workspace.use", "email.inbox.view" }, RequireAll: true),
        new("prepare_email_decision", "Email enquiries", "Prepare Keep, Ignore or Restore", new[] { "email.workspace.use", "email.inbox.view", "email.inbox.manage" }, McpScopes.Email, Write: true, RequireAll: true),
        new("prepare_email_quotation", "Email enquiries", "Prepare quotation with explicit item prices", new[] { "email.workspace.use", "email.inbox.view", "email.enquiries.manage", "salesquotes.manage.create" }, McpScopes.Quotes, Write: true, RequireAll: true),
        new("get_quote", "Sales", "Read a quotation", new[] { "salesquotes.list.view" }),
        new("prepare_quote", "Sales", "Prepare a quotation", new[] { "salesquotes.manage.create" }, McpScopes.Quotes, Write: true),
        new("search_sales_orders", "Sales", "Find sales orders", new[] { "salesorders.list.view" }),
        new("get_sales_order", "Sales", "Read a sales order", new[] { "salesorders.list.view" }),
        new("search_invoices", "Sales", "Find bills and invoices", new[] { "bills.list.view", "invoices.list.view" }),
        new("get_invoice", "Sales", "Read a bill or invoice", new[] { "bills.list.view", "invoices.list.view" }),
        new("prepare_bill", "Sales", "Prepare a bill", new[] { "bills.manage.create", "bills.manage.create.standalone" }, McpScopes.Bills, Write: true),

        new("search_challans", "Deliveries", "Find delivery challans", new[] { "challans.list.view" }),
        new("get_challan", "Deliveries", "Read a delivery challan", new[] { "challans.list.view" }),
        new("prepare_challan", "Deliveries", "Prepare a delivery challan", new[] { "challans.manage.create" }, McpScopes.Challans, Write: true),
        new("get_daily_work_queue", "Daily work", "Show delivery and collection work", new[] { "challans.list.view", "salesorders.list.view", "reports.outstanding.view" }),

        new("get_stock", "Inventory", "Read stock balances", new[] { "stock.dashboard.view" }),
        new("search_item_types", "Inventory", "Find items", new[] { "itemtypes.manage.view" }),
        new("item_rate_history", "Inventory", "Read item rate history", new[] { "itemratehistory.view" }),

        new("search_purchase_bills", "Purchases", "Find purchase bills", new[] { "purchasebills.list.view" }),
        new("get_purchase_bill", "Purchases", "Read a purchase bill", new[] { "purchasebills.list.view" }),
        new("search_goods_receipts", "Purchases", "Find goods receipts", new[] { "goodsreceipts.list.view" }),

        new("search_receipts", "Collections and payments", "Find customer receipts", new[] { "accounting.receipts.view" }),
        new("search_payments", "Collections and payments", "Find supplier payments", new[] { "accounting.payments.view" }),
        new("outstanding_ledger", "Collections and payments", "Read a customer's outstanding statement", new[] { "reports.outstanding.view" }),
        new("receivables_by_client", "Collections and payments", "Read customer receivables", new[] { "reports.outstanding.view" }),

        new("sales_summary", "Sales reports", "Read filed sales totals", new[] { "reports.sales.view" }),
        new("tax_sheet_summary", "Sales reports", "Read tax sheet totals", new[] { "reports.taxsheet.view" }),

        new("get_trial_balance", "Accounting", "Read the trial balance", new[] { "accounting.gl.view" }),
        new("get_profit_and_loss", "Accounting", "Read profit and loss", new[] { "accounting.reports.view" }),
        new("get_balance_sheet", "Accounting", "Read the balance sheet", new[] { "accounting.reports.view" }),
        new("get_cash_book", "Accounting", "Read the cash book", new[] { "accounting.reports.view" }),
        new("get_aged_payables", "Accounting", "Read aged supplier payables", new[] { "accounting.reports.view" }),
        new("get_party_ledger", "Accounting", "Read a customer or supplier ledger", new[] { "accounting.reports.view" }),

        new("list_print_templates", "Print templates", "List print designs", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_print_template", "Print templates", "Read print design content", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_print_contract", "Print templates", "Read supported print fields", new[] { "printtemplates.manage.view" }, McpScopes.TemplatesRead),
        new("get_document_print_data", "Print templates", "Read actual document print data", new[]
        {
            "challans.print.view", "bills.print.view", "invoices.print.view", "salesquotes.print.view",
            "salesorders.print.view", "purchasebills.print.view", "goodsreceipts.print.view",
            "accounting.receipts.print", "accounting.payments.print", "withholdingtax.print.view"
        }, McpScopes.DocumentsRead),

        new("get_onboarding_schema", "Onboarding", "Read permitted import sheets and fields", new[] { "onboarding.import.run" }),
        new("get_company_onboarding_status", "Onboarding", "Check company onboarding progress", new[] { "onboarding.import.run" }),
    });

    public static McpToolAccessDefinition? Find(string name) =>
        All.FirstOrDefault(tool => string.Equals(tool.Name, name, StringComparison.Ordinal));
}
