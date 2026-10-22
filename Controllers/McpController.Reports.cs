using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Every accounting report and the sales reports, as the Reports screens run them (MCP parity
    /// phase 4). Balances, ageing, outstanding amounts, statements and cheque registers come from the
    /// ledger reports, which are right even though receipts are taken on account; a bill's own
    /// "paid" status is not offered for that reason (CLAUDE.md §5b-8).
    ///
    /// Every filter that names a record (account, group, customer, supplier, payee, item, division) is
    /// checked to be this company's before the screen's action runs; the action then applies its own
    /// period and division rules.
    /// </summary>
    public partial class McpController
    {
        private static readonly Dictionary<string, Func<AccountingReportsController, int, ReportFilterDto, Task<object>>> AccountingReports = new()
        {
            ["expenses"] = (c, id, f) => ScreenAsync(() => c.Expenses(id, f)),
            ["expenses-detail"] = (c, id, f) => ScreenAsync(() => c.ExpenseDetail(id, f)),
            ["expenses-summary"] = (c, id, f) => ScreenAsync(() => c.ExpenseSummary(id, f)),
            ["cash-book"] = (c, id, f) => ScreenAsync(() => c.CashBook(id, f)),
            ["bank-book"] = (c, id, f) => ScreenAsync(() => c.BankBook(id, f)),
            ["cash-bank-summary"] = (c, id, f) => ScreenAsync(() => c.CashBankSummary(id, f)),
            ["receipts-register"] = (c, id, f) => ScreenAsync(() => c.ReceiptsRegister(id, f)),
            ["payments-register"] = (c, id, f) => ScreenAsync(() => c.PaymentsRegister(id, f)),
            ["receipts-by-account"] = (c, id, f) => ScreenAsync(() => c.ReceiptsByAccount(id, f)),
            ["payments-by-account"] = (c, id, f) => ScreenAsync(() => c.PaymentsByAccount(id, f)),
            ["cheques-in-hand"] = (c, id, f) => ScreenAsync(() => c.ChequesInHand(id, f)),
            ["cheques-issued"] = (c, id, f) => ScreenAsync(() => c.ChequesIssued(id, f)),
            ["unallocated"] = (c, id, f) => ScreenAsync(() => c.Unallocated(id, f)),
            ["customer-ledger"] = (c, id, f) => ScreenAsync(() => c.CustomerLedger(id, f)),
            ["customer-statement"] = (c, id, f) => ScreenAsync(() => c.CustomerStatement(id, f)),
            ["customer-balances"] = (c, id, f) => ScreenAsync(() => c.CustomerBalances(id, f)),
            ["receivables-aging"] = (c, id, f) => ScreenAsync(() => c.AgedReceivables(id, f)),
            ["customer-outstanding"] = (c, id, f) => ScreenAsync(() => c.CustomerOutstanding(id, f)),
            ["customer-sales"] = (c, id, f) => ScreenAsync(() => c.CustomerSales(id, f)),
            ["supplier-ledger"] = (c, id, f) => ScreenAsync(() => c.SupplierLedger(id, f)),
            ["supplier-statement"] = (c, id, f) => ScreenAsync(() => c.SupplierStatement(id, f)),
            ["supplier-balances"] = (c, id, f) => ScreenAsync(() => c.SupplierBalances(id, f)),
            ["payables-aging"] = (c, id, f) => ScreenAsync(() => c.AgedPayables(id, f)),
            ["supplier-outstanding"] = (c, id, f) => ScreenAsync(() => c.SupplierOutstanding(id, f)),
            ["supplier-purchases"] = (c, id, f) => ScreenAsync(() => c.SupplierPurchases(id, f)),
            ["balance-sheet"] = (c, id, f) => ScreenAsync(() => c.BalanceSheet(id, f)),
            ["profit-loss"] = (c, id, f) => ScreenAsync(() => c.ProfitAndLoss(id, f)),
            ["general-ledger"] = (c, id, f) => ScreenAsync(() => c.GeneralLedger(id, f)),
            ["account-balances"] = (c, id, f) => ScreenAsync(() => c.AccountBalances(id, f)),
            ["trial-balance"] = (c, id, f) => ScreenAsync(() => c.TrialBalanceReport(id, f)),
            ["sales-register"] = (c, id, f) => ScreenAsync(() => c.SalesRegister(id, f)),
            ["purchase-register"] = (c, id, f) => ScreenAsync(() => c.PurchaseRegister(id, f)),
            ["sales-detail"] = (c, id, f) => ScreenAsync(() => c.SalesDetail(id, f)),
            ["sales-summary"] = (c, id, f) => ScreenAsync(() => c.SalesSummary(id, f)),
            ["purchase-summary"] = (c, id, f) => ScreenAsync(() => c.PurchaseSummary(id, f)),
            ["credit-debit-notes"] = (c, id, f) => ScreenAsync(() => c.CreditDebitNotes(id, f)),
            ["tax-summary"] = (c, id, f) => ScreenAsync(() => c.TaxSummary(id, f)),
            ["output-tax"] = (c, id, f) => ScreenAsync(() => c.OutputTax(id, f)),
            ["input-tax"] = (c, id, f) => ScreenAsync(() => c.InputTax(id, f)),
            ["tax-transactions"] = (c, id, f) => ScreenAsync(() => c.TaxTransactions(id, f)),
            ["tax-by-customer"] = (c, id, f) => ScreenAsync(() => c.TaxByCustomer(id, f)),
            ["tax-by-supplier"] = (c, id, f) => ScreenAsync(() => c.TaxBySupplier(id, f)),
            ["journal-register"] = (c, id, f) => ScreenAsync(() => c.JournalRegister(id, f)),
            ["posting-exceptions"] = (c, id, f) => ScreenAsync(() => c.PostingExceptions(id, f)),
            ["revenue-summary"] = (c, id, f) => ScreenAsync(() => c.RevenueSummary(id, f)),
            ["expense-summary-accounts"] = (c, id, f) => ScreenAsync(() => c.ExpenseSummaryByAccount(id, f)),
            ["cash-flow"] = (c, id, f) => ScreenAsync(() => c.CashFlow(id, f)),
        };

        private void AddReportTools(List<Tool> t)
        {
            t.AddRange(new Tool[]
            {
                new("get_accounting_report", "Any accounting report exactly as the Accounting Reports screen shows it: " + string.Join(", ", AccountingReports.Keys) + ". Filters as on the screen; give a period (today, thisweek, thismonth, lastmonth, thisquarter, thisyear, lastyear) or dateFrom/dateTo with period custom. Long lists are paged with offset/limit.",
                    Obj(new
                    {
                        companyId = CompanyProp, report = new { type = "string", @enum = AccountingReports.Keys.ToArray() },
                        period = Str(30), dateFrom = DateProp, dateTo = DateProp, divisionId = DivisionProp, accountId = Int(), accountGroupId = Int(), paymentAccountId = Int(),
                        clientId = Int(), supplierId = Int(), payeeType = new { type = "string", @enum = new[] { "Client", "Supplier" } }, payeeId = Int(), itemTypeId = Int(),
                        tax = Str(30), status = Str(30), search = Str(200), sortBy = Str(40),
                        offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows },
                    }, "companyId", "report"),
                    Read: GetAccountingReportAsync),
                new("get_invoice_sales_detail", "The Invoice Sales Detail report: every sale bill line with its item, quantity, price and tax, for a period (thismonth, thisyear, lastyear ...) or a year and month.",
                    Obj(new { companyId = CompanyProp, period = Str(30), dateFrom = DateProp, dateTo = DateProp, year = new { type = "integer" }, month = new { type = "integer", minimum = 1, maximum = 12 },
                        search = Str(200), fbrStatus = Str(30), clientId = Int(), offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: GetInvoiceSalesDetailAsync),
                new("get_client_ledger", "The Client Ledger report: bills and receipts per customer for a month, a year or a date range.",
                    Obj(new { companyId = CompanyProp, year = new { type = "integer" }, month = new { type = "integer", minimum = 1, maximum = 12 }, clientId = Int(), dateFrom = DateProp, dateTo = DateProp,
                        offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: GetClientLedgerAsync),
            });
        }

        private async Task<object> GetAccountingReportAsync(JsonElement args)
        {
            await Need("accounting.reports.view");
            var companyId = await CompanyArg(args);
            var report = OptText(args, "report", 40) ?? "";
            if (!AccountingReports.TryGetValue(report, out var run)) throw new ToolError("Unknown report.");
            var (from, to) = Dates(args);
            var filter = new ReportFilterDto
            {
                Period = OptText(args, "period", 30) is { Length: > 0 } p ? p : null, From = from, To = to,
                Tax = OptText(args, "tax", 30), Status = OptText(args, "status", 30), Search = StrArg(args, "search") is { Length: > 0 } s ? s : null,
                SortBy = OptText(args, "sortBy", 40),
            };
            if (OptId(args, "divisionId") is int div)
            {
                await AssertDivisionReadAsync(companyId, div);
                filter.DivisionId = div;
            }
            foreach (var (name, set) in new (string, Action<int>)[] { ("accountId", v => filter.AccountId = v), ("paymentAccountId", v => filter.PaymentAccountId = v) })
                if (OptId(args, name) is int acc)
                {
                    if (!await _context.Accounts.AsNoTracking().AnyAsync(a => a.Id == acc && a.CompanyId == companyId)) throw new ToolError(Denied);
                    set(acc);
                }
            if (OptId(args, "accountGroupId") is int grp)
            {
                if (!await _context.AccountGroups.AsNoTracking().AnyAsync(g => g.Id == grp && g.CompanyId == companyId)) throw new ToolError(Denied);
                filter.AccountGroupId = grp;
            }
            filter.ClientId = await ClientInCompanyAsync(args, companyId, required: false);
            filter.SupplierId = await SupplierInCompanyAsync(args, companyId, required: false);
            filter.ItemTypeId = await ItemInCompanyAsync(args, "itemTypeId", companyId);
            if (OptText(args, "payeeType", 20) is { Length: > 0 } payeeType)
            {
                filter.PayeeType = payeeType;
                filter.PayeeId = payeeType == "Client" ? await ClientInCompanyAsync(args, companyId, name: "payeeId")
                    : payeeType == "Supplier" ? await SupplierInCompanyAsync(args, companyId, name: "payeeId")
                    : throw new ToolError("payeeType must be Client or Supplier.");
            }
            var result = await run(Screen<AccountingReportsController>(), companyId, filter);
            var (offset, limit) = Window(args);
            return Bounded(result, offset, limit);
        }

        private async Task<object> GetInvoiceSalesDetailAsync(JsonElement args)
        {
            await Need("reports.invoicedetail.view");
            var companyId = await CompanyArg(args);
            var (from, to) = Dates(args);
            var query = new InvoiceSalesDetailQueryDto
            {
                Period = OptText(args, "period", 30) is { Length: > 0 } p ? p : null, From = from, To = to, Year = IntArg(args, "year"), Month = IntArg(args, "month"),
                Search = StrArg(args, "search") is { Length: > 0 } s ? s : null, FbrStatus = OptText(args, "fbrStatus", 30),
                ClientId = await ClientInCompanyAsync(args, companyId, required: false),
            };
            var result = await ScreenAsync(() => Screen<ReportsController>().GetInvoiceSalesDetail(companyId, query));
            var (offset, limit) = Window(args);
            return Bounded(result, offset, limit);
        }

        private async Task<object> GetClientLedgerAsync(JsonElement args)
        {
            await Need("reports.clientledger.view");
            var companyId = await CompanyArg(args);
            var (from, to) = Dates(args);
            var client = await ClientInCompanyAsync(args, companyId, required: false);
            var result = await ScreenAsync(() => Screen<ReportsController>().GetClientLedger(companyId, IntArg(args, "year"), IntArg(args, "month"), client, from, to));
            var (offset, limit) = Window(args);
            return Bounded(result, offset, limit);
        }
    }
}
