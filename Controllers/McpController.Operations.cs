using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

public partial class McpController
{
    private static void AddOperationsTools(List<ExpandedTool> tools)
    {
        // Local descriptors avoid partial-class static initialisation ordering.
        var company = new { type = "integer", minimum = 1 };
        var id = new { type = "integer", minimum = 1 };
        var text = new { type = "string", maxLength = 200 };
        var date = new { type = "string", format = "date" };
        var size = new { type = "integer", minimum = 1, maximum = 100, @default = 25 };
        var page = new { type = "integer", minimum = 1, @default = 1 };
        var search = ExpandedSchema(new { companyId = company, search = text, page, pageSize = size, dateFrom = date, dateTo = date }, "companyId");
        var report = ExpandedSchema(new { companyId = company, dateFrom = date, dateTo = date, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId");
        var asOfReport = ExpandedSchema(new { companyId = company, asOf = date, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId");
        tools.AddRange(new ExpandedTool[]
        {
            new("get_daily_work_queue", "Current service-backed challan and delivery work, with optional overdue collections. Unavailable permission sections are labelled. This is a current queue, not historical daily sales.", ExpandedSchema(new { companyId = company, limit = size }, "companyId"), new[] { "challans.list.view", "salesorders.list.view", "accounting.reports.view" }),
            new("get_quote", "Quotation totals and a capped page of its lines. Uses server GST figures; quotations do not currently support withholding tax.", ExpandedSchema(new { companyId = company, quoteId = id, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId", "quoteId"), new[] { "salesquotes.list.view" }),
            new("search_sales_orders", "Find sales orders with computed delivery and billing status.", search, new[] { "salesorders.list.view" }),
            new("get_sales_order", "Order header and a capped page of remaining delivery quantities.", ExpandedSchema(new { companyId = company, orderId = id, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId", "orderId"), new[] { "salesorders.list.view" }),
            new("search_suppliers", "Find supplier IDs and names; contact and tax identifiers are omitted.", ExpandedSchema(new { companyId = company, search = text, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId"), new[] { "suppliers.manage.view" }),
            new("search_item_types", "Find catalog IDs, names, HS codes and units in the selected company. No stock/cost figures.", ExpandedSchema(new { companyId = company, search = text, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId"), new[] { "itemtypes.manage.view" }),
            new("search_purchase_bills", "Purchase bill totals; settlement fields require payment visibility.", search, new[] { "purchasebills.list.view" }),
            new("get_purchase_bill", "Purchase bill totals and a capped page of lines; settlement fields require payment visibility.", ExpandedSchema(new { companyId = company, purchaseBillId = id, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId", "purchaseBillId"), new[] { "purchasebills.list.view" }),
            new("search_goods_receipts", "Goods receipts with supplier, source purchase bill and status.", search, new[] { "goodsreceipts.list.view" }),
            new("search_receipts", "Receipt summaries without bank, cheque numbers, free-text notes or allocations.", search, new[] { "accounting.receipts.view" }),
            new("search_payments", "Payment summaries without bank, cheque numbers, free-text notes or allocations.", search, new[] { "accounting.payments.view" }),
            new("get_trial_balance", "Ledger trial-balance totals and capped account balances, debit-positive. Account labels are omitted.", report, new[] { "accounting.reports.view" }),
            new("get_profit_and_loss", "Server-computed income, expenses and net profit; natural signs. No account-level details.", report, new[] { "accounting.reports.view" }),
            new("get_balance_sheet", "Server-computed assets, liabilities, equity and balance status; no account-level details.", asOfReport, new[] { "accounting.reports.view" }),
            new("get_cash_book", "Cash-book totals and capped account IDs/balances; bank account names are omitted.", report, new[] { "accounting.reports.view" }),
            new("get_aged_payables", "Supplier ageing balances from the accounting screen, capped; same due-date basis.", asOfReport, new[] { "accounting.reports.view" }),
            new("get_party_ledger", "Party ledger balances and capped source-linked movement; narratives/references omitted.", ExpandedSchema(new { companyId = company, partyType = new { type = "string", @enum = new[] { "Client", "Supplier" } }, partyId = id, dateFrom = date, dateTo = date, offset = new { type = "integer", minimum = 0 }, limit = size }, "companyId", "partyType", "partyId"), new[] { "accounting.reports.view" })
        });
    }

    private T OperationService<T>() where T : notnull => HttpContext.RequestServices.GetRequiredService<T>();
    private static int OperationId(JsonElement args, string name)
    {
        var id = IntArg(args, name);
        return id is > 0 ? id.Value : throw new ToolError($"{name} must be a positive integer.");
    }
    private static (DateTime? From, DateTime? To) OperationDates(JsonElement args)
    {
        var from = DateArg(args, "dateFrom");
        var to = DateArg(args, "dateTo");
        if (from.HasValue && to.HasValue && from > to) throw new ToolError("dateFrom must be on or before dateTo.");
        return (from, to);
    }
    private static object OperationPage<T>(PagedResult<T> result, IEnumerable<object> items) => new { items, result.TotalCount, result.Page, result.PageSize, result.TotalPages };
    private static object OrderSummary(SalesOrderDto r) => new { r.Id, r.CompanyId, r.SalesOrderNumber, r.ClientId, r.ClientName, r.OrderDate, r.RequiredDate, r.Status, r.FulfillmentStatus, r.InvoiceStatus, r.SalesQuoteId, r.BillableChallanCount };
    private async Task<bool> OperationPurchasePaymentVisibleAsync() =>
        await _permissions.HasPermissionAsync(CurrentUserId, "accounting.paymentstatus.view")
        || await _permissions.HasPermissionAsync(CurrentUserId, "accounting.payments.view")
        || await _permissions.HasPermissionAsync(CurrentUserId, "accounting.payments.create");
    private static object PurchaseSummary(PurchaseBillDto r, bool payment) => new
    {
        r.Id, r.CompanyId, r.PurchaseBillNumber, r.Date, r.SupplierId, r.SupplierName, r.Subtotal, r.GSTRate, r.GSTAmount, r.GrandTotal,
        r.WithholdingTaxRate, r.WithholdingTaxAmount, collectible = r.GrandTotal - r.WithholdingTaxAmount, r.ReconciliationStatus,
        amountPaid = payment ? (decimal?)r.AmountPaid : null, balanceDue = payment ? (decimal?)r.BalanceDue : null, paymentStatus = payment ? r.PaymentStatus : null,
        dueDate = payment ? r.DueDate : null
    };

    private async Task<object> CallOperationsToolAsync(string name, JsonElement args)
    {
        var descriptor = ExpandedTools.Single(t => t.Name == name);
        await Need(descriptor.Permissions);
        var companyId = await CompanyArg(args);
        var (from, to) = OperationDates(args);
        var page = PaginationHelper.ClampPage(IntArg(args, "page") ?? 1);
        var size = Size(args, "pageSize");
        var (offset, limit) = Window(args);
        var search = StrArg(args, "search");
        switch (name)
        {
            case "get_daily_work_queue": return await DailyWorkQueueAsync(companyId, limit);
            case "get_quote":
                var quote = await _quotes.GetByIdAsync(OperationId(args, "quoteId"));
                if (quote == null || quote.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
                return new { quote.Id, quote.CompanyId, quote.QuoteNumber, quote.Date, quote.ValidUntil, quote.ClientId, quote.ClientName, quote.Status, quote.Subtotal, quote.GSTRate, quote.GSTAmount, quote.GrandTotal, quote.ConvertedToSalesOrderId,
                    withholdingSupported = false, lines = new { offset, limit, totalCount = quote.Items.Count, items = quote.Items.Skip(offset).Take(limit).Select(x => new { x.Id, x.ItemTypeId, x.Description, x.Quantity, x.Unit, x.UnitPrice, x.LineTotal }) } };
            case "search_sales_orders":
                var orders = await OperationService<ISalesOrderService>().GetPagedByCompanyAsync(companyId, page, size, search, null, null, from, to);
                return OperationPage(orders, orders.Items.Where(x => x.CompanyId == companyId).Select(OrderSummary));
            case "get_sales_order":
                var order = await OperationService<ISalesOrderService>().GetByIdAsync(OperationId(args, "orderId"));
                if (order == null || order.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
                return new { header = OrderSummary(order), lines = new { offset, limit, totalCount = order.Items.Count, items = order.Items.Skip(offset).Take(limit).Select(x => new { x.Id, x.ItemTypeId, x.Description, x.Quantity, x.Unit, x.UnitPrice, x.DeliveredQuantity, x.RemainingQuantity, x.LineStatus }) } };
            case "search_suppliers":
                var suppliers = (await OperationService<ISupplierService>().GetByCompanyAsync(companyId)).Where(x => x.CompanyId == companyId && x.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();
                return new { totalCount = suppliers.Count, offset, limit, items = suppliers.Skip(offset).Take(limit).Select(x => new { x.Id, x.CompanyId, x.Name }) };
            case "search_item_types":
                var types = (await OperationService<IItemTypeService>().GetAllAsync(companyId)).Where(x => (x.Name + " " + x.HSCode).Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();
                return new { totalCount = types.Count, offset, limit, items = types.Skip(offset).Take(limit).Select(x => new { x.Id, x.Name, x.HSCode, x.UOM }) };
            case "search_purchase_bills":
                var purchases = await OperationService<IPurchaseBillService>().GetPagedByCompanyAsync(companyId, page, size, search, null, from, to);
                var visibility = await OperationPurchasePaymentVisibleAsync();
                return OperationPage(purchases, purchases.Items.Where(x => x.CompanyId == companyId).Select(x => PurchaseSummary(x, visibility)));
            case "get_purchase_bill":
                var purchase = await OperationService<IPurchaseBillService>().GetByIdAsync(OperationId(args, "purchaseBillId"));
                if (purchase == null || purchase.CompanyId != companyId) throw new ToolError("Resource unavailable or access denied.");
                return new { header = PurchaseSummary(purchase, await OperationPurchasePaymentVisibleAsync()), lines = new { offset, limit, totalCount = purchase.Items.Count, items = purchase.Items.Skip(offset).Take(limit).Select(x => new { x.Id, x.ItemTypeId, x.Description, x.Quantity, x.UOM, x.UnitPrice, x.LineTotal, x.HSCode }) } };
            case "search_goods_receipts":
                var goods = await OperationService<IGoodsReceiptService>().GetPagedByCompanyAsync(companyId, page, size, search, null, null, from, to);
                return OperationPage(goods, goods.Items.Where(x => x.CompanyId == companyId).Select(x => (object)new { x.Id, x.CompanyId, x.GoodsReceiptNumber, x.ReceiptDate, x.SupplierId, x.SupplierName, x.PurchaseBillId, x.Status, lineCount = x.Items.Count }));
            case "search_receipts":
            case "search_payments":
                var direction = name == "search_receipts" ? PaymentDirection.Receipt : PaymentDirection.Payment;
                var payments = await OperationService<IPaymentService>().GetPagedByCompanyAsync(companyId, direction, page, size, search, null, from, to);
                return OperationPage(payments, payments.Items.Where(x => x.CompanyId == companyId && x.Direction == direction.ToString()).Select(x => (object)new { x.Id, x.CompanyId, x.Number, x.Date, x.ContactId, x.ContactName, x.Amount, x.ChequeStatus, x.IsCancelled }));
            case "get_trial_balance":
                var trial = await OperationService<IGeneralLedgerService>().GetTrialBalanceAsync(companyId, from, to);
                return new { companyId, trial.From, trial.To, trial.TotalOpening, trial.TotalDebit, trial.TotalCredit, trial.TotalClosing, isBalanced = Math.Abs(trial.TotalDebit - trial.TotalCredit) <= 0.01m, signBasis = "debit-positive", rows = new { offset, limit, totalCount = trial.Rows.Count, items = trial.Rows.Skip(offset).Take(limit).Select(x => new { x.AccountId, x.AccountType, x.Opening, x.Debit, x.Credit, x.Closing }) }, currency = "PKR" };
            case "get_profit_and_loss":
                return await OperationService<IAccountingReportService>().GetProfitAndLossAsync(companyId, new ReportFilterDto { From = from, To = to, Page = page, PageSize = size }, false);
            case "get_balance_sheet":
                return await OperationService<IAccountingReportService>().GetBalanceSheetAsync(companyId, new ReportFilterDto { To = DateArg(args, "asOf"), Page = page, PageSize = size }, false);
            case "get_cash_book":
                return await OperationService<IAccountingReportService>().GetCashBookAsync(companyId, new ReportFilterDto { From = from, To = to, Page = page, PageSize = size }, "all");
            case "get_aged_payables":
                var aged = await OperationService<IGeneralLedgerService>().GetAgedPayablesAsync(companyId, DateArg(args, "asOf"));
                return new { companyId, aged.Kind, aged.AsOf, aged.Total, aged.Current, aged.Days1To30, aged.Days31To60, aged.Days61To90, aged.Over90, rows = new { offset, limit, totalCount = aged.Rows.Count, items = aged.Rows.Skip(offset).Take(limit) }, currency = "PKR" };
            case "get_party_ledger":
                var partyType = StrArg(args, "partyType", 20);
                if (partyType is not ("Client" or "Supplier")) throw new ToolError("partyType must be Client or Supplier.");
                var partyId = OperationId(args, "partyId");
                if (partyType == "Client" && !await _context.Clients.AnyAsync(c => c.Id == partyId && c.CompanyId == companyId) || partyType == "Supplier" && !await _context.Suppliers.AnyAsync(c => c.Id == partyId && c.CompanyId == companyId)) throw new ToolError("Resource unavailable or access denied.");
                return await OperationService<IAccountingReportService>().GetPartyLedgerAsync(companyId, new ReportFilterDto { From = from, To = to, ClientId = partyType == "Client" ? partyId : null, SupplierId = partyType == "Supplier" ? partyId : null, Page = page, PageSize = size }, partyType == "Client", false);
            default: throw new ToolError("Unknown tool.");
        }
    }

    private async Task<object> DailyWorkQueueAsync(int companyId, int limit)
    {
        var sections = new List<object>();
        var today = PakistanClock.Today;
        if (await _permissions.HasPermissionAsync(CurrentUserId, "challans.list.view"))
        {
            var rows = (await _challans.GetDeliveryChallansByCompanyAsync(companyId)).Where(x => x.CompanyId == companyId && x.InvoiceId == null && x.Status != "Cancelled" && (!x.DeliveryDate.HasValue || x.DeliveryDate.Value.Date <= today)).ToList();
            sections.Add(new { section = "unbilledChallans", available = true, totalCount = rows.Count, items = rows.OrderBy(x => x.DeliveryDate).ThenBy(x => x.Id).Take(limit).Select(x => new { x.Id, x.ChallanNumber, x.ClientName, x.Status, x.DeliveryDate, screen = "/challans" }) });
        }
        else sections.Add(new { section = "unbilledChallans", available = false, reason = "permission" });
        if (await _permissions.HasPermissionAsync(CurrentUserId, "salesorders.list.view"))
        {
            var rows = (await OperationService<ISalesOrderService>().GetOpenByCompanyAsync(companyId)).Where(x => x.CompanyId == companyId && x.OrderDate.Date <= today).ToList();
            sections.Add(new { section = "undeliveredOrders", available = true, totalCount = rows.Count, items = rows.OrderBy(x => x.RequiredDate).ThenBy(x => x.Id).Take(limit).Select(x => new { x.Id, x.SalesOrderNumber, x.ClientName, x.RequiredDate, x.FulfillmentStatus, x.InvoiceStatus, screen = "/sales-orders" }) });
        }
        else sections.Add(new { section = "undeliveredOrders", available = false, reason = "permission" });
        if (await _permissions.HasPermissionAsync(CurrentUserId, "accounting.reports.view") && await CanSeePaymentAsync())
        {
            var rows = (await _invoices.GetByCompanyAsync(companyId)).Where(x => x.CompanyId == companyId && !x.IsCancelled && (x.DocumentType == null || x.DocumentType == 4) && x.PaymentStatus == "Overdue" && x.Date.Date <= today).ToList();
            sections.Add(new { section = "overdueCollections", available = true, totalCount = rows.Count, balance = rows.Sum(x => x.BalanceDue), items = rows.OrderBy(x => x.Date).ThenBy(x => x.Id).Take(limit).Select(x => new { x.Id, x.InvoiceNumber, x.ClientName, x.BalanceDue, x.PaymentStatus, screen = "/bills" }) });
        }
        else sections.Add(new { section = "overdueCollections", available = false, reason = "permissionOrPaymentVisibility" });
        return new { companyId, asOf = Ymd(today), basis = "Current service statuses; not a historical snapshot or complete sales report.", limit, sections, currency = "PKR" };
    }
}
