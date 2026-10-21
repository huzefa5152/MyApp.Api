using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Read tools. Each one runs the service its screen uses, behind the screen's permission
    /// key, the company gate and the user's division scope, and returns a bounded projection:
    /// ids, names, totals, a capped page. Payment status and per-document balances are never
    /// returned (CLAUDE.md §5b-8: receipts here are taken on account, so they misread), and
    /// neither are bank, cheque or tax-identifier fields.
    /// </summary>
    public partial class McpController
    {
        private static readonly string[] ChallanStatuses = { "Pending", "Imported", "No PO", "Invoiced", "Cancelled", "Setup Required" };

        private static object SearchSchema(params (string Name, object Prop)[] extra)
        {
            var props = new Dictionary<string, object>
            {
                ["companyId"] = CompanyProp, ["search"] = Str(200), ["dateFrom"] = DateProp, ["dateTo"] = DateProp,
                ["page"] = new { type = "integer", minimum = 1, @default = 1 },
                ["pageSize"] = new { type = "integer", minimum = 1, maximum = MaxToolRows, @default = 25 },
            };
            foreach (var (n, p) in extra) props[n] = p;
            return Obj(props, "companyId");
        }

        private static object OneSchema(string idName, bool lines = true) => lines
            ? Obj(new Dictionary<string, object> { ["companyId"] = CompanyProp, [idName] = Int(), ["offset"] = new { type = "integer", minimum = 0 }, ["limit"] = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId", idName)
            : Obj(new Dictionary<string, object> { ["companyId"] = CompanyProp, [idName] = Int() }, "companyId", idName);

        private static readonly object ReportSchema = Obj(new
        {
            companyId = CompanyProp, dateFrom = DateProp, dateTo = DateProp,
            divisionId = new { type = "integer", minimum = 1, description = "Optional: one division." },
            offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows },
        }, "companyId");

        private static readonly object YearPeriodSchema = Obj(new
        {
            companyId = CompanyProp,
            year = new { type = "integer", minimum = 2000, maximum = 2100, description = "Give a year (with an optional month), or dateFrom and dateTo." },
            month = new { type = "integer", minimum = 1, maximum = 12 }, dateFrom = DateProp, dateTo = DateProp,
            offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows },
        }, "companyId");

        private void AddReadTools(List<Tool> t)
        {
            var windowed = new Dictionary<string, object> { ["companyId"] = CompanyProp, ["search"] = Str(200), ["offset"] = new { type = "integer", minimum = 0 }, ["limit"] = new { type = "integer", minimum = 1, maximum = MaxToolRows } };
            t.AddRange(new Tool[]
            {
                new("search_clients", "Find a company's customers by name: id and name only (no contact or tax details).", Obj(windowed, "companyId"), Read: SearchClientsAsync),
                new("search_suppliers", "Find a company's suppliers by name: id and name only.", Obj(windowed, "companyId"), Read: SearchSuppliersAsync),
                new("search_item_types", "Find items this company holds: id, the company's own name for the item (displayName), the catalog name, HS code and unit. Use the id in documents.",
                    SearchSchema(), Read: SearchItemTypesAsync),
                new("item_rate_history", "Past billed unit prices of an item, with average, lowest and highest. Use it to price a quotation or bill.",
                    SearchSchema(("itemTypeId", Int()), ("clientId", Int())), Read: ItemRateHistoryAsync),
                new("search_quotes", "Find sales quotations.", SearchSchema(("clientId", Int())), Read: SearchQuotesAsync),
                new("get_quote", "One quotation with a capped page of lines.", OneSchema("quoteId"), Read: GetQuoteAsync),
                new("search_sales_orders", "Find sales orders with delivery and billing status.", SearchSchema(("clientId", Int())), Read: SearchOrdersAsync),
                new("get_sales_order", "One sales order with remaining quantities per line (salesOrderItemId is what prepare_challan delivers).", OneSchema("orderId"), Read: GetOrderAsync),
                new("search_challans", "Find delivery challans. Billable ones (Pending, Imported, No PO, not yet billed) can go on a bill.",
                    SearchSchema(("clientId", Int()), ("status", new { type = "string", @enum = ChallanStatuses })), Read: SearchChallansAsync),
                new("get_challan", "One challan with its lines; each line id is the deliveryItemId prepare_bill prices.", OneSchema("challanId"), Read: GetChallanAsync),
                new("search_invoices", "Find sale bills with FBR status, taxes and whether a bill is a demo bill (demo bills are excluded from every report).",
                    SearchSchema(("clientId", Int())), Read: SearchInvoicesAsync),
                new("get_invoice", "One sale bill with a capped page of lines.", OneSchema("invoiceId"), Read: GetInvoiceAsync),
                new("search_purchase_bills", "Find purchase bills.", SearchSchema(("supplierId", Int())), Read: SearchPurchaseBillsAsync),
                new("get_purchase_bill", "One purchase bill with a capped page of lines.", OneSchema("purchaseBillId"), Read: GetPurchaseBillAsync),
                new("search_goods_receipts", "Find goods receipts.", SearchSchema(("supplierId", Int())), Read: SearchGoodsReceiptsAsync),
                new("search_receipts", "Customer receipts: number, date, customer, amount, unallocated amount. No bank or cheque details.", SearchSchema(("clientId", Int())), Read: a => SearchMoneyAsync(a, PaymentDirection.Receipt)),
                new("search_payments", "Supplier payments: number, date, payee, amount, unallocated amount. No bank or cheque details.", SearchSchema(("supplierId", Int())), Read: a => SearchMoneyAsync(a, PaymentDirection.Payment)),
                new("search_gds", "Find GDs (import consignments) with totals and settlement status.",
                    Obj(new { companyId = CompanyProp, search = Str(100), onlyOutstanding = new { type = "boolean" }, page = new { type = "integer", minimum = 1 }, pageSize = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"),
                    Read: SearchGdsAsync),
                new("get_gd", "One GD with its lines (claim month, costs, disposition, item) and charges. Line ids are what prepare_gd_line_correction and prepare_gd_claim_month take.",
                    OneSchema("gdId"), Read: GetGdAsync),
                new("search_lcs", "Letters of credit with the GDs shipped against them.", Obj(new { companyId = CompanyProp, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"), Read: SearchLcsAsync),
                new("get_gd_register", "The GD register: every GD line with duties, taxes, claim month and claim status.",
                    Obj(new { companyId = CompanyProp, search = Str(100), offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId"), Read: GdRegisterAsync),
                new("get_input_tax_worksheet", "The monthly input-tax worksheet: output tax, import and purchase input tax, cap, admissible and carried forward, per month.",
                    Obj(new { companyId = CompanyProp, fromMonth = Str(7, "yyyy-MM"), toMonth = Str(7, "yyyy-MM") }, "companyId"), Read: InputTaxAsync),
                new("get_stock", "On-hand QUANTITY per item (opening plus movements, within the user's divisions), with the company's own item names. Valuation stays on the Stock screen.",
                    Obj(windowed, "companyId"), Read: GetStockAsync),
                new("get_opening_stock", "Opening balances per item: quantity, value excluding tax, sales tax rate, as-of date.",
                    Obj(windowed, "companyId"), Read: GetOpeningStockAsync),
                new("sales_summary", "The Sales report for a period: FBR-filed sale bills with totals, month by month, and the top customers. Amounts in PKR; 'amount' excludes tax.",
                    YearPeriodSchema, Read: SalesSummaryAsync),
                new("tax_sheet_summary", "The Tax Sheet for a period: bill lines whose item still has no valid HS code, grouped by item.",
                    YearPeriodSchema, Read: TaxSheetSummaryAsync),
                new("get_customer_balances", "Customer balances from the ledger (opening, debit, credit, closing), as the Customer Balances report shows them.", ReportSchema, Read: a => AccountingReportAsync(a, "customerBalances")),
                new("get_supplier_balances", "Supplier balances from the ledger, as the Supplier Balances report shows them.", ReportSchema, Read: a => AccountingReportAsync(a, "supplierBalances")),
                new("get_trial_balance", "Trial balance report rows and totals.", ReportSchema, Read: a => AccountingReportAsync(a, "trialBalance")),
                new("get_profit_and_loss", "Profit and loss: income, cost of sales, expenses and net profit, with its lines.", ReportSchema, Read: a => AccountingReportAsync(a, "profitAndLoss")),
                new("get_balance_sheet", "Balance sheet as of dateTo: assets, liabilities, equity, and whether it balances.", ReportSchema, Read: a => AccountingReportAsync(a, "balanceSheet")),
                new("get_cash_book", "Cash book: opening, receipts, payments and closing for the period.", ReportSchema, Read: a => AccountingReportAsync(a, "cashBook")),
                new("get_aged_payables", "Supplier ageing, as the Payables Ageing report shows it.", ReportSchema, Read: a => AccountingReportAsync(a, "agedPayables")),
                new("get_party_ledger", "One customer's or supplier's ledger for a period: opening, movements and closing.",
                    Obj(new { companyId = CompanyProp, partyType = new { type = "string", @enum = new[] { "Client", "Supplier" } }, partyId = Int(), dateFrom = DateProp, dateTo = DateProp, offset = new { type = "integer", minimum = 0 }, limit = new { type = "integer", minimum = 1, maximum = MaxToolRows } }, "companyId", "partyType", "partyId"),
                    Read: a => AccountingReportAsync(a, "partyLedger")),
                new("search_accounts", "Find this company's ledger accounts (id, code, name, type) for a journal entry.", Obj(windowed, "companyId"), Read: SearchAccountsAsync),
            });
        }

        // ── master data ────────────────────────────────────────────────────

        private async Task<object> SearchClientsAsync(JsonElement args)
        {
            await Need(McpToolAccessCatalog.Find("search_clients")!.Permissions);
            var companyId = await CompanyArg(args);
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var rows = (await Svc<IClientService>().GetByCompanyAsync(companyId))
                .Where(c => c.CompanyId == companyId && c.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(c => c.Name).ToList();
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit).Select(c => new { id = c.Id, c.Name, c.RegistrationType }) };
        }

        private async Task<object> SearchSuppliersAsync(JsonElement args)
        {
            await Need(McpToolAccessCatalog.Find("search_suppliers")!.Permissions);
            var companyId = await CompanyArg(args);
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var rows = (await Svc<ISupplierService>().GetByCompanyAsync(companyId))
                .Where(c => c.CompanyId == companyId && c.Name.Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(c => c.Name).ToList();
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit).Select(c => new { id = c.Id, c.Name, c.RegistrationType }) };
        }

        // GET /api/itemtypes/paged?companyId= : the company's visible items with its own names applied.
        private async Task<object> SearchItemTypesAsync(JsonElement args)
        {
            await Need(McpToolAccessCatalog.Find("search_item_types")!.Permissions);
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args);
            var restrictions = await _divisions.GetRestrictionsAsync(CurrentUserId);
            var r = await Svc<IItemTypeService>().GetPagedAsync(StrArg(args, "search"), page, size, companyId: companyId,
                divisionRestrictionsByCompany: restrictions);
            return new
            {
                items = r.Items.Select(i => new
                {
                    i.Id, displayName = string.IsNullOrWhiteSpace(i.CompanyDisplayName) ? i.Name : i.CompanyDisplayName,
                    catalogName = i.CatalogName ?? i.Name, hsCode = i.HSCode, uom = i.UOM, i.SaleType, i.DivisionId,
                }),
                r.TotalCount, r.Page, r.PageSize, r.TotalPages,
            };
        }

        /// <summary>One answer for "not this company's item" and "no such item".</summary>
        private async Task<int?> ItemInCompanyAsync(JsonElement el, string name, int companyId)
        {
            if (!Has(el, name)) return null;
            var id = IdArg(el, name);
            if (!await ItemTypeMembership.IsVisibleAsync(_context, id, new[] { companyId }))
                throw new ToolError($"Item {id} is not one of this company's items (search_item_types).");
            return id;
        }

        private async Task<object> ItemRateHistoryAsync(JsonElement args)
        {
            await Need("itemratehistory.view");
            var companyId = await CompanyArg(args);
            var itemTypeId = await ItemInCompanyAsync(args, "itemTypeId", companyId);
            var clientId = await ClientInCompanyAsync(args, companyId, required: false);
            var (page, size) = Paging(args);
            var r = await Svc<IInvoiceService>().GetItemRateHistoryAsync(companyId, page, size, itemTypeId, StrArg(args, "search"),
                clientId, DateArg(args, "dateFrom"), DateArg(args, "dateTo"), await DivisionScopeAsync(companyId));
            return new
            {
                summary = new { count = r.TotalCount, average = r.AvgUnitPrice, lowest = r.MinUnitPrice, highest = r.MaxUnitPrice, currency = "PKR" },
                items = r.Items, r.Page, r.PageSize,
            };
        }

        private async Task<int?> ClientInCompanyAsync(JsonElement args, int companyId, bool required = true, string name = "clientId")
        {
            if (!Has(args, name)) return required ? throw new ToolError($"{name} is required.") : null;
            var id = IdArg(args, name);
            if (!await _context.Clients.AsNoTracking().AnyAsync(c => c.Id == id && c.CompanyId == companyId))
                throw new ToolError("The customer does not belong to this company.");
            return id;
        }

        private async Task<int?> SupplierInCompanyAsync(JsonElement args, int companyId, bool required = true, string name = "supplierId")
        {
            if (!Has(args, name)) return required ? throw new ToolError($"{name} is required.") : null;
            var id = IdArg(args, name);
            if (!await _context.Suppliers.AsNoTracking().AnyAsync(c => c.Id == id && c.CompanyId == companyId))
                throw new ToolError("The supplier does not belong to this company.");
            return id;
        }

        private static (DateTime? From, DateTime? To) Dates(JsonElement args)
        {
            var from = DateArg(args, "dateFrom");
            var to = DateArg(args, "dateTo");
            if (from.HasValue && to.HasValue && from > to) throw new ToolError("dateFrom must be on or before dateTo.");
            return (from, to);
        }

        private static object Paged<T>(PagedResult<T> r, IEnumerable<object> items) => new { items, r.TotalCount, r.Page, r.PageSize, r.TotalPages };

        // ── sales documents ────────────────────────────────────────────────

        private async Task<object> SearchQuotesAsync(JsonElement args)
        {
            await Need("salesquotes.list.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<ISalesQuoteService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"), null,
                await ClientInCompanyAsync(args, companyId, required: false), from, to, null, await DivisionScopeAsync(companyId));
            return Paged(r, r.Items.Where(q => q.CompanyId == companyId).Select(q => (object)new
            {
                q.Id, q.QuoteNumber, date = Ymd(q.Date), q.ClientId, q.ClientName, q.DivisionId, q.Status, q.Subtotal, q.GSTRate, q.GSTAmount, q.GrandTotal, q.ConvertedToSalesOrderId,
            }));
        }

        private async Task<object> GetQuoteAsync(JsonElement args)
        {
            await Need("salesquotes.list.view");
            var companyId = await CompanyArg(args);
            var q = await Svc<ISalesQuoteService>().GetByIdAsync(IdArg(args, "quoteId"));
            if (q == null || q.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, q.DivisionId);
            var (offset, limit) = Window(args);
            return new
            {
                q.Id, q.QuoteNumber, date = Ymd(q.Date), validUntil = Ymd(q.ValidUntil), q.ClientId, q.ClientName, q.DivisionId, q.Status,
                q.Subtotal, q.GSTRate, q.GSTAmount, q.GrandTotal, q.ConvertedToSalesOrderId,
                lines = new { totalCount = q.Items.Count, offset, items = q.Items.Skip(offset).Take(limit).Select(i => new { i.Id, i.ItemTypeId, i.ItemTypeName, i.Description, i.Quantity, i.Unit, i.UnitPrice, i.LineTotal }) },
            };
        }

        private static object OrderRow(SalesOrderDto o) => new
        {
            o.Id, o.SalesOrderNumber, orderDate = Ymd(o.OrderDate), requiredDate = Ymd(o.RequiredDate), o.ClientId, o.ClientName, o.DivisionId,
            o.CustomerPoNumber, o.Status, o.FulfillmentStatus, o.InvoiceStatus, o.SalesQuoteId, o.ChallanCount, o.BillableChallanCount,
        };

        private async Task<object> SearchOrdersAsync(JsonElement args)
        {
            await Need("salesorders.list.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<ISalesOrderService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"), null,
                await ClientInCompanyAsync(args, companyId, required: false), from, to, null, await DivisionScopeAsync(companyId));
            return Paged(r, r.Items.Where(o => o.CompanyId == companyId).Select(OrderRow));
        }

        private async Task<object> GetOrderAsync(JsonElement args)
        {
            await Need("salesorders.list.view");
            var companyId = await CompanyArg(args);
            var o = await Svc<ISalesOrderService>().GetByIdAsync(IdArg(args, "orderId"));
            if (o == null || o.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, o.DivisionId);
            var (offset, limit) = Window(args);
            return new
            {
                header = OrderRow(o),
                lines = new { totalCount = o.Items.Count, offset, items = o.Items.Skip(offset).Take(limit).Select(i => new { salesOrderItemId = i.Id, i.ItemTypeId, i.ItemTypeName, i.Description, i.Quantity, i.Unit, i.UnitPrice, i.DeliveredQuantity, i.RemainingQuantity, i.LineStatus }) },
            };
        }

        private static bool Billable(DeliveryChallanDto c) => c.InvoiceId == null && c.Status is "Pending" or "Imported" or "No PO";

        private async Task<object> SearchChallansAsync(JsonElement args)
        {
            await Need("challans.list.view");
            var companyId = await CompanyArg(args);
            var status = StrArg(args, "status", 20);
            if (status != "" && !ChallanStatuses.Contains(status)) throw new ToolError("status must be one of: " + string.Join(", ", ChallanStatuses) + ".");
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<IDeliveryChallanService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"), status == "" ? null : status,
                await ClientInCompanyAsync(args, companyId, required: false), from, to, null, null, await DivisionScopeAsync(companyId));
            return Paged(r, r.Items.Where(c => c.CompanyId == companyId).Select(c => (object)new
            {
                c.Id, c.ChallanNumber, c.ClientId, c.ClientName, c.DivisionId, c.PoNumber, deliveryDate = Ymd(c.DeliveryDate), c.Status, c.InvoiceId, c.SalesOrderId, billable = Billable(c),
            }));
        }

        private async Task<object> GetChallanAsync(JsonElement args)
        {
            await Need("challans.list.view");
            var companyId = await CompanyArg(args);
            var c = await Svc<IDeliveryChallanService>().GetByIdAsync(IdArg(args, "challanId"));
            if (c == null || c.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, c.DivisionId);
            var (offset, limit) = Window(args);
            return new
            {
                c.Id, c.ChallanNumber, c.ClientId, c.ClientName, c.DivisionId, c.PoNumber, poDate = Ymd(c.PoDate), deliveryDate = Ymd(c.DeliveryDate),
                c.Site, c.Status, c.InvoiceId, c.SalesOrderId, billable = Billable(c),
                lines = new { totalCount = c.Items.Count, offset, items = c.Items.Skip(offset).Take(limit).Select(i => new { deliveryItemId = i.Id, i.ItemTypeId, i.ItemTypeName, i.Description, i.Quantity, i.Unit }) },
            };
        }

        private static object InvoiceRow(InvoiceDto r, bool isDemo) => new
        {
            r.Id, r.InvoiceNumber, date = Ymd(r.Date), r.ClientId, r.ClientName, r.DivisionId, r.Subtotal, r.GSTRate, r.GSTAmount,
            r.AdvanceTaxRate, r.AdvanceTaxAmount, r.FurtherTaxRate, r.FurtherTaxAmount, r.WithholdingTaxAmount, r.GrandTotal,
            r.FbrStatus, r.FbrInvoiceNumber, r.FbrFiledManually, submittedAt = r.FbrSubmittedAt, r.IsCancelled, isDemo,
        };

        private async Task<HashSet<int>> DemoIdsAsync(IEnumerable<int> ids)
        {
            var list = ids.ToList();
            return (await _context.Invoices.AsNoTracking().Where(i => list.Contains(i.Id) && i.IsDemo).Select(i => i.Id).ToListAsync()).ToHashSet();
        }

        private async Task<object> SearchInvoicesAsync(JsonElement args)
        {
            await Need("bills.list.view", "invoices.list.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<IInvoiceService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"),
                await ClientInCompanyAsync(args, companyId, required: false), from, to, null, null, await DivisionScopeAsync(companyId));
            var rows = r.Items.Where(i => i.CompanyId == companyId).ToList();
            var demo = await DemoIdsAsync(rows.Select(i => i.Id));
            return Paged(r, rows.Select(i => InvoiceRow(i, demo.Contains(i.Id))));
        }

        private async Task<object> GetInvoiceAsync(JsonElement args)
        {
            await Need("bills.list.view", "invoices.list.view");
            var companyId = await CompanyArg(args);
            var bill = await OwnBillAsync(companyId, IdArg(args, "invoiceId"));
            var (offset, limit) = Window(args);
            var demo = await DemoIdsAsync(new[] { bill.Id });
            return new
            {
                header = InvoiceRow(bill, demo.Contains(bill.Id)), bill.PaymentTerms, bill.PaymentMode, challanNumbers = bill.ChallanNumbers,
                lines = new { totalCount = bill.Items.Count, offset, items = bill.Items.Skip(offset).Take(limit).Select(i => new { i.Id, i.DeliveryItemId, i.ItemTypeId, i.ItemTypeName, i.Description, i.Quantity, i.UOM, i.UnitPrice, i.LineTotal, hsCode = i.HSCode, i.SaleType }) },
            };
        }

        /// <summary>The bill, asserted against its STORED company and division: one answer for missing and someone else's.</summary>
        private async Task<InvoiceDto> OwnBillAsync(int companyId, int invoiceId)
        {
            var bill = await Svc<IInvoiceService>().GetByIdAsync(invoiceId);
            if (bill == null || bill.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, bill.DivisionId);
            return bill;
        }

        // ── purchases and money ────────────────────────────────────────────

        private static object PurchaseRow(PurchaseBillDto r) => new
        {
            r.Id, r.PurchaseBillNumber, date = Ymd(r.Date), r.SupplierId, r.SupplierName, r.DivisionId, r.SupplierBillNumber,
            r.Subtotal, r.GSTRate, r.GSTAmount, r.WithholdingTaxAmount, r.GrandTotal, r.ReconciliationStatus,
        };

        private async Task<object> SearchPurchaseBillsAsync(JsonElement args)
        {
            await Need("purchasebills.list.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<IPurchaseBillService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"),
                await SupplierInCompanyAsync(args, companyId, required: false), from, to, null, await DivisionScopeAsync(companyId));
            return Paged(r, r.Items.Where(b => b.CompanyId == companyId).Select(PurchaseRow));
        }

        private async Task<object> GetPurchaseBillAsync(JsonElement args)
        {
            await Need("purchasebills.list.view");
            var companyId = await CompanyArg(args);
            var b = await Svc<IPurchaseBillService>().GetByIdAsync(IdArg(args, "purchaseBillId"));
            if (b == null || b.CompanyId != companyId) throw new ToolError(Denied);
            await AssertDivisionReadAsync(companyId, b.DivisionId);
            var (offset, limit) = Window(args);
            return new
            {
                header = PurchaseRow(b),
                lines = new { totalCount = b.Items.Count, offset, items = b.Items.Skip(offset).Take(limit).Select(i => new { i.Id, i.ItemTypeId, i.ItemTypeName, i.Description, i.Quantity, i.UOM, i.UnitPrice, i.LineTotal, hsCode = i.HSCode }) },
            };
        }

        private async Task<object> SearchGoodsReceiptsAsync(JsonElement args)
        {
            await Need("goodsreceipts.list.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var r = await Svc<IGoodsReceiptService>().GetPagedByCompanyAsync(companyId, page, size, StrArg(args, "search"),
                await SupplierInCompanyAsync(args, companyId, required: false), null, from, to, null, await DivisionScopeAsync(companyId));
            return Paged(r, r.Items.Where(g => g.CompanyId == companyId).Select(g => (object)new
            {
                g.Id, g.GoodsReceiptNumber, receiptDate = Ymd(g.ReceiptDate), g.SupplierId, g.SupplierName, g.DivisionId, g.PurchaseBillId, g.PurchaseBillNumber, g.Status, lineCount = g.Items.Count,
            }));
        }

        // GET /api/accounting/receipts|payments/company/{id}/paged
        private async Task<object> SearchMoneyAsync(JsonElement args, PaymentDirection direction)
        {
            var receipts = direction == PaymentDirection.Receipt;
            await Need(receipts ? "accounting.receipts.view" : "accounting.payments.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args); var (from, to) = Dates(args);
            var contact = receipts ? await ClientInCompanyAsync(args, companyId, required: false) : await SupplierInCompanyAsync(args, companyId, required: false);
            var r = await Svc<IPaymentService>().GetPagedByCompanyAsync(companyId, direction, page, size, StrArg(args, "search"), contact, from, to);
            var divisions = await DivisionScopeAsync(companyId);
            return Paged(r, r.Items.Where(x => x.CompanyId == companyId && x.Direction == direction.ToString()
                    && (divisions == null || x.DivisionId == null || divisions.Contains(x.DivisionId.Value)))
                .Select(x => (object)new
                {
                    x.Id, x.Number, x.Reference, date = Ymd(x.Date), x.ContactType, x.ContactId, x.ContactName, x.DivisionId, x.Method,
                    x.Amount, x.UnallocatedAmount, x.IsCancelled,
                    allocations = x.Allocations.Select(a => new { a.Kind, a.InvoiceId, a.InvoiceNumber, a.PurchaseBillId, a.PurchaseBillNumber, a.ImportConsignmentId, a.Amount }),
                }));
        }

        // ── import costing ─────────────────────────────────────────────────

        private async Task<object> SearchGdsAsync(JsonElement args)
        {
            await Need("importcosting.consignments.view");
            var companyId = await CompanyArg(args);
            var (page, size) = Paging(args);
            var r = await Svc<IImportConsignmentService>().GetPagedAsync(companyId, page, size, OptBool(args, "onlyOutstanding") ?? false);
            var search = StrArg(args, "search", 100);
            return new
            {
                items = r.Items.Where(g => search == "" || g.GdNumber.Contains(search, StringComparison.OrdinalIgnoreCase)).Select(g => new
                {
                    gdId = g.Id, g.GdNumber, gdDate = Ymd(g.GdDate), g.LineCount, g.TotalCostExcludingTax, g.TotalInputTax, g.TotalIncomeTax, g.TotalSellingValue,
                    g.Mode, g.HasJournalEntry, g.ImportClearingCredited, g.AmountSettled, g.SettlementStatus,
                }),
                r.TotalCount, r.Page, r.PageSize, r.TotalOutstanding, currency = "PKR",
            };
        }

        /// <summary>The GD, matched against its STORED company: one answer for missing and someone else's.</summary>
        private async Task<ImportConsignmentDetailDto> OwnGdAsync(int companyId, int gdId)
        {
            var gd = await Svc<IImportConsignmentService>().GetDetailAsync(gdId);
            if (gd == null || gd.CompanyId != companyId) throw new ToolError(Denied);
            return gd;
        }

        private async Task<object> GetGdAsync(JsonElement args)
        {
            await Need("importcosting.consignments.view");
            var companyId = await CompanyArg(args);
            var gd = await OwnGdAsync(companyId, IdArg(args, "gdId"));
            var (offset, limit) = Window(args);
            var charges = await Svc<IImportConsignmentService>().GetChargesAsync(gd.Id);
            return new
            {
                gdId = gd.Id, gd.GdNumber, gdDate = Ymd(gd.GdDate), gd.Mode, lcId = gd.ImportLcId, gd.BlNumber,
                gd.TotalCostExcludingTax, gd.TotalCharges, gd.TotalInputTax, gd.TotalIncomeTax, gd.TotalSellingValue,
                gd.HasJournalEntry, gd.ImportClearingCredited, gd.AmountSettled, gd.SettlementStatus,
                charges = charges.Select(c => new { chargeId = c.Id, c.Kind, c.Amount, c.Description, c.PaidTo, chargeDate = Ymd(c.ChargeDate) }),
                lines = new
                {
                    totalCount = gd.Lines.Count, offset,
                    items = gd.Lines.Skip(offset).Take(limit).Select(l => new
                    {
                        lineId = l.Id, l.SourceRow, l.DescriptionOnSheet, l.ItemTypeName, l.HsCode, l.Quantity, l.Unit, claimMonth = Ymd(l.ClaimMonth),
                        l.AssessedValue, l.CustomsDuty, l.Acd, l.RegulatoryDuty, l.Others, l.SalesTaxRate, l.AstRate, l.IncomeTaxRate, l.AddOnProfit,
                        l.CostExcludingTax, l.ChargesAllocated, l.SellingValueExcludingTax, l.Disposition,
                    }),
                },
                currency = "PKR",
            };
        }

        private async Task<object> SearchLcsAsync(JsonElement args)
        {
            await Need("importcosting.lc.view");
            var companyId = await CompanyArg(args);
            var (offset, limit) = Window(args);
            var rows = await Svc<ImportLcService>().ListAsync(companyId);
            return new
            {
                totalCount = rows.Count, offset,
                items = rows.Skip(offset).Take(limit).Select(l => new
                {
                    lcId = l.Id, l.LcNumber, l.SupplierName, l.Currency, l.ForeignAmount, l.ExchangeRate, openedOn = Ymd(l.OpenedOn), expiresOn = Ymd(l.ExpiresOn),
                    l.Status, l.GdCount, l.AssessedValue, l.LandedCost, l.Owed, l.Settled, l.Outstanding,
                    gds = l.Gds.Select(g => new { gdId = g.Id, g.GdNumber, gdDate = Ymd(g.GdDate), g.BlNumber }),
                }),
            };
        }

        /// <summary>The Import Tax Desk is company-wide: a division-restricted user is refused, as on the screen.</summary>
        private async Task RequireWholeCompanyAsync(int companyId, string what)
        {
            if (await DivisionScopeAsync(companyId) != null)
                throw new ToolError($"{what} covers the whole company, so it needs access to every division.");
        }

        private async Task<object> GdRegisterAsync(JsonElement args)
        {
            await Need("importcosting.taxdesk.view");
            var companyId = await CompanyArg(args);
            await RequireWholeCompanyAsync(companyId, "The GD register");
            var search = StrArg(args, "search", 100);
            var (offset, limit) = Window(args);
            var rows = (await Svc<IImportTaxWorksheetService>().CostingLinesAsync(companyId))
                .Where(l => search == "" || (l.GdNumber + " " + l.Description + " " + l.ItemName).Contains(search, StringComparison.OrdinalIgnoreCase)).ToList();
            return new
            {
                totalCount = rows.Count, offset,
                totals = new { assessedValue = rows.Sum(r => r.AssessedValue), salesTax = rows.Sum(r => r.SalesTax), inputTax = rows.Sum(r => r.InputTax), incomeTax = rows.Sum(r => r.IncomeTax), landedCost = rows.Sum(r => r.LandedCost) },
                items = rows.Skip(offset).Take(limit).Select(r => new
                {
                    r.Source, gdId = r.ConsignmentId, r.GdNumber, gdDate = Ymd(r.GdDate), claimMonth = Ymd(r.ClaimMonth), claimBy = Ymd(r.ClaimBy), r.ClaimStatus,
                    r.Description, r.ItemName, r.HsCode, r.Quantity, r.Unit, r.AssessedValue, r.CustomsDuty, r.Acd, r.RegulatoryDuty, r.SalesTaxRate, r.SalesTax,
                    r.ValueAddedTax, r.IncomeTax, r.Charges, r.LandedCost, r.InputTax, r.SellingValue,
                }),
                currency = "PKR",
            };
        }

        private async Task<object> InputTaxAsync(JsonElement args)
        {
            await Need("importcosting.taxdesk.view");
            var companyId = await CompanyArg(args);
            await RequireWholeCompanyAsync(companyId, "The input-tax worksheet");
            var (error, dto) = await Svc<IImportTaxWorksheetService>().BuildAsync(companyId, OptText(args, "fromMonth", 7), OptText(args, "toMonth", 7));
            if (error != null || dto == null) throw new ToolError(error ?? Denied);
            return new
            {
                from = Ymd(dto.From), to = Ymd(dto.To), dto.CapPercent, dto.ClaimPeriods, dto.LapsedInputTax, dto.OpenInputTax, dto.UnclaimedLineCount,
                months = dto.Months.Select(m => new
                {
                    month = m.Month.ToString("yyyy-MM"), m.OutputTax, m.ImportSalesTax, m.ImportValueAddedTax, m.ImportOtherTax, m.PurchaseInputTax,
                    m.InputThisMonth, m.BroughtForward, m.Available, m.CapLimit, m.Admissible, m.CarriedForward, m.Payable, m.CapApplied,
                }),
                currency = "PKR",
            };
        }

        // ── stock ──────────────────────────────────────────────────────────

        // Quantity only: opening + IN - OUT, over the movements inside the user's divisions (as the stock screen walks them).
        private async Task<object> GetStockAsync(JsonElement args)
        {
            await Need("stock.dashboard.view");
            var companyId = await CompanyArg(args);
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var divisions = await DivisionScopeAsync(companyId);
            var moves = _context.StockMovements.AsNoTracking().Where(m => m.CompanyId == companyId);
            if (divisions != null) moves = moves.Where(m => m.DivisionId == null || divisions.Contains(m.DivisionId.Value));
            var flow = await moves.GroupBy(m => new { m.ItemTypeId, m.Direction })
                .Select(g => new { g.Key.ItemTypeId, g.Key.Direction, Qty = g.Sum(m => m.Quantity) }).ToListAsync();
            var openings = await _context.OpeningStockBalances.AsNoTracking().Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ItemTypeId).Select(g => new { Id = g.Key, Qty = g.Sum(o => o.Quantity) }).ToDictionaryAsync(x => x.Id, x => x.Qty);
            var ids = flow.Select(f => f.ItemTypeId).Concat(openings.Keys).Distinct().ToList();
            var items = await _context.ItemTypes.AsNoTracking().Where(i => ids.Contains(i.Id))
                .Select(i => new { i.Id, i.Name, i.HSCode, i.UOM }).ToDictionaryAsync(i => i.Id);
            var names = await CompanyItemNames.ForCompanyAsync(_context, companyId, ids);
            var rows = ids.Where(items.ContainsKey).Select(id =>
            {
                var it = items[id];
                var opening = openings.GetValueOrDefault(id);
                var inQ = flow.Where(f => f.ItemTypeId == id && f.Direction == StockMovementDirection.In).Sum(f => f.Qty);
                var outQ = flow.Where(f => f.ItemTypeId == id && f.Direction == StockMovementDirection.Out).Sum(f => f.Qty);
                return new { itemTypeId = id, displayName = CompanyItemNames.Pick(names, id, it.Name), hsCode = it.HSCode, uom = it.UOM, opening, totalIn = inQ, totalOut = outQ, onHand = opening + inQ - outQ };
            }).Where(r => search == "" || (r.displayName + " " + r.hsCode).Contains(search, StringComparison.OrdinalIgnoreCase))
              .OrderBy(r => r.displayName).ToList();
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit), basis = "quantity; valuation and FIFO pools stay on the Stock screen" };
        }

        private async Task<object> GetOpeningStockAsync(JsonElement args)
        {
            await Need("stock.opening.manage");
            var companyId = await CompanyArg(args);
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var rows = await _context.OpeningStockBalances.AsNoTracking().Where(o => o.CompanyId == companyId)
                .Select(o => new { o.Id, o.ItemTypeId, Name = o.ItemType!.Name, o.Quantity, o.ValueExcludingTax, o.SalesTaxRate, o.AsOfDate, Lots = o.Lots.Count }).ToListAsync();
            var names = await CompanyItemNames.ForCompanyAsync(_context, companyId, rows.Select(r => r.ItemTypeId));
            var list = rows.Select(r => new
            {
                openingBalanceId = r.Id, r.ItemTypeId, displayName = CompanyItemNames.Pick(names, r.ItemTypeId, r.Name), r.Quantity, r.ValueExcludingTax, r.SalesTaxRate, asOfDate = Ymd(r.AsOfDate), lotCount = r.Lots,
            }).Where(r => search == "" || r.displayName.Contains(search, StringComparison.OrdinalIgnoreCase)).OrderBy(r => r.displayName).ToList();
            return new { totalCount = list.Count, offset, items = list.Skip(offset).Take(limit), currency = "PKR" };
        }

        // ── reports ────────────────────────────────────────────────────────

        /// <summary>The report screens' period rule: a year (optional month), or both dates.</summary>
        private static (int? Year, int? Month, DateTime? From, DateTime? To) YearPeriod(JsonElement args)
        {
            var (from, to) = Dates(args);
            var year = IntArg(args, "year");
            var month = IntArg(args, "month");
            if (from.HasValue || to.HasValue)
            {
                if (!from.HasValue || !to.HasValue) throw new ToolError("Give both dateFrom and dateTo.");
                if ((to.Value - from.Value).TotalDays > 366 * 5) throw new ToolError("Choose a range of at most five years.");
                return (null, null, from, to);
            }
            if (month.HasValue && !year.HasValue) throw new ToolError("month needs a year.");
            if (!year.HasValue) throw new ToolError("Give a year, or dateFrom and dateTo.");
            return (year, month, null, null);
        }

        private async Task<object> SalesSummaryAsync(JsonElement args)
        {
            await Need("reports.sales.view");
            var companyId = await CompanyArg(args);
            await RequireWholeCompanyAsync(companyId, "The Sales report");
            var (year, month, from, to) = YearPeriod(args);
            var r = await Svc<IReportService>().GetSalesReportAsync(companyId, year, month, "all", from, to);
            var invoices = r.Invoices;
            var (offset, limit) = Window(args);
            return new
            {
                period = new { label = r.PeriodLabel, from = Ymd(r.DateFrom), to = Ymd(r.DateTo) },
                totals = new { invoiceCount = r.InvoiceCount, amount = r.GrandAmount, tax = r.GrandTax, total = r.GrandTotal },
                byMonth = invoices.GroupBy(i => i.DocumentDate.ToString("yyyy-MM")).OrderBy(g => g.Key)
                    .Select(g => new { month = g.Key, invoiceCount = g.Count(), amount = g.Sum(i => i.TotalAmount), tax = g.Sum(i => i.TotalTax), total = g.Sum(i => i.TotalGross) }),
                topCustomers = invoices.GroupBy(i => i.Customer).Select(g => new { customer = g.Key, invoiceCount = g.Count(), total = g.Sum(i => i.TotalGross) })
                    .OrderByDescending(c => c.total).Take(10),
                invoices = new { totalCount = invoices.Count, offset, items = invoices.OrderBy(i => i.DocumentDate).Skip(offset).Take(limit).Select(i => new { i.DocumentNumber, date = Ymd(i.DocumentDate), i.Customer, amount = i.TotalAmount, tax = i.TotalTax, total = i.TotalGross }) },
                currency = "PKR",
            };
        }

        private async Task<object> TaxSheetSummaryAsync(JsonElement args)
        {
            await Need("reports.taxsheet.view");
            var companyId = await CompanyArg(args);
            await RequireWholeCompanyAsync(companyId, "The Tax Sheet");
            var (year, month, from, to) = YearPeriod(args);
            var r = await Svc<IReportService>().GetTaxSheetAsync(companyId, year, month, from, to);
            var (offset, limit) = Window(args);
            return new
            {
                period = new { label = r.PeriodLabel, from = Ymd(r.DateFrom), to = Ymd(r.DateTo) },
                totals = new { invoicesNeedingHsCode = r.InvoiceCount, lines = r.RowCount, excluding = r.GrandExcluding, tax = r.GrandTax, total = r.GrandTotal },
                byItemType = r.Rows.GroupBy(x => x.ItemTypeName).Select(g => new { itemType = g.Key, lines = g.Count(), total = g.Sum(x => x.Total) }).OrderByDescending(x => x.total).Take(25),
                rows = new { totalCount = r.Rows.Count, offset, items = r.Rows.Skip(offset).Take(limit).Select(x => new { x.DocumentNumber, date = Ymd(x.DocumentDate), party = x.PartyName, x.ItemTypeName, excluding = x.ExcludingAmount, tax = x.SalesTax, x.Total }) },
                currency = "PKR",
            };
        }

        /// <summary>
        /// The accounting report screens, run exactly as <c>AccountingReportsController</c> runs
        /// them (its PrepareAsync: period validation, explicit division asserted, the user's
        /// division scope applied), with every list in the answer capped.
        /// </summary>
        private async Task<object> AccountingReportAsync(JsonElement args, string which)
        {
            await Need("accounting.reports.view");
            var companyId = await CompanyArg(args);
            var (from, to) = Dates(args);
            var filter = new ReportFilterDto { From = from, To = to };
            if (ReportPeriod.Validate(ReportPeriod.ParsePreset(null), from, to) is { } bad) throw new ToolError(bad);
            if (OptId(args, "divisionId") is int div)
            {
                filter.DivisionId = div;
                await AssertDivisionReadAsync(companyId, div);
            }
            filter.AllowedDivisionIds = (await DivisionScopeAsync(companyId))?.ToList();
            var reports = Svc<IAccountingReportService>();
            object result;
            switch (which)
            {
                case "customerBalances": result = await reports.GetPartyBalanceSummaryAsync(companyId, filter, customers: true); break;
                case "supplierBalances": result = await reports.GetPartyBalanceSummaryAsync(companyId, filter, customers: false); break;
                case "trialBalance": result = await reports.GetTrialBalanceReportAsync(companyId, filter); break;
                case "profitAndLoss": result = await reports.GetProfitAndLossAsync(companyId, filter, comparative: false); break;
                case "balanceSheet": result = await reports.GetBalanceSheetAsync(companyId, filter, comparative: false); break;
                case "cashBook": result = await reports.GetCashBookAsync(companyId, filter, "cash"); break;
                case "agedPayables": result = await reports.GetAgingReportAsync(companyId, filter, customers: false); break;
                case "partyLedger":
                    var type = StrArg(args, "partyType", 20);
                    if (type is not ("Client" or "Supplier")) throw new ToolError("partyType must be Client or Supplier.");
                    var customers = type == "Client";
                    var partyId = customers ? await ClientInCompanyAsync(args, companyId, name: "partyId") : await SupplierInCompanyAsync(args, companyId, name: "partyId");
                    if (customers) filter.ClientId = partyId; else filter.SupplierId = partyId;
                    result = await reports.GetPartyLedgerAsync(companyId, filter, customers);
                    break;
                default: throw new ToolError("Unknown report.");
            }
            var (offset, limit) = Window(args);
            return Bounded(result, offset, limit);
        }

        /// <summary>
        /// A report DTO as the screen receives it, with every list capped: top-level lists are
        /// paged with offset/limit and report their totalCount, nested lists keep 50 entries.
        /// </summary>
        private static object Bounded(object dto, int offset, int limit)
        {
            var el = JsonSerializer.SerializeToElement(dto, dto.GetType(), Json);
            var output = new Dictionary<string, object?>();
            foreach (var p in el.EnumerateObject())
            {
                if (p.Name is "companyContact" or "party") continue; // letterhead contact blocks: addresses and tax ids
                output[p.Name] = p.Value.ValueKind == JsonValueKind.Array
                    ? new { totalCount = p.Value.GetArrayLength(), offset, items = p.Value.EnumerateArray().Skip(offset).Take(limit).Select(Cap).ToList() }
                    : Cap(p.Value);
            }
            output["currency"] = "PKR";
            return output;

            static object? Cap(JsonElement v) => v.ValueKind switch
            {
                JsonValueKind.Array => v.EnumerateArray().Take(50).Select(Cap).ToList(),
                JsonValueKind.Object => v.EnumerateObject().ToDictionary(x => x.Name, x => Cap(x.Value)),
                _ => v.Clone(),
            };
        }

        private async Task<object> SearchAccountsAsync(JsonElement args)
        {
            await Need("accounting.coa.view", "accounting.journal.create");
            var companyId = await CompanyArg(args);
            var search = StrArg(args, "search");
            var (offset, limit) = Window(args);
            var divisions = await DivisionScopeAsync(companyId);
            var rows = (await _context.Accounts.AsNoTracking().Where(a => a.CompanyId == companyId && a.IsActive)
                .Select(a => new
                {
                    accountId = a.Id, a.Code, a.Name, type = a.AccountType.ToString(), a.DivisionId,
                    // Money accounts move only through receipts, payments and transfers (the journal service's rule).
                    journalPostable = !(a.ControlType == MyApp.Api.Models.Accounting.ControlType.BankCash || a.AccountGroup.Name.Contains("bank") || a.AccountGroup.Name.Contains("cash")),
                }).ToListAsync())
                .Where(a => divisions == null || a.DivisionId == null || divisions.Contains(a.DivisionId.Value))
                .Where(a => search == "" || (a.Code + " " + a.Name).Contains(search, StringComparison.OrdinalIgnoreCase))
                .OrderBy(a => a.Code).ThenBy(a => a.Name).ToList();
            return new { totalCount = rows.Count, offset, items = rows.Skip(offset).Take(limit) };
        }
    }
}
