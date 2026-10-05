using MyApp.Api.Services.Interfaces;
using System.Text.Json;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// "Ask your data": read-only report tools. Each one runs the SAME report service its screen
    /// uses, behind the SAME permission key and company check, and returns a bounded summary (totals,
    /// a handful of top rows, a capped page) instead of dumping a year of invoices into a chat.
    /// Nothing here writes, and payment details such as cheque numbers and bank references are
    /// deliberately left out of the output.
    /// </summary>
    public partial class McpController
    {
        private static readonly string[] BuyerTypes = { "all", "registered", "unregistered" };
        private static readonly string[] LedgerStatuses = { "unpaid", "paid", "all" };

        // Self-contained statics: see the note in the Writes partial about initialisation order.
        private static readonly object RCompanyId = new { type = "integer", minimum = 1, description = "Company id from list_companies." };
        private static readonly object RReadAnnotations = new { readOnlyHint = true, destructiveHint = false, idempotentHint = true, openWorldHint = false };
        private static readonly object RYear = new { type = "integer", minimum = 2000, maximum = 2100, description = "Calendar year. Give a year, or dateFrom and dateTo together." };
        private static readonly object RMonth = new { type = "integer", minimum = 1, maximum = 12, description = "1 to 12 for one month of that year; omit for the whole year." };
        private static readonly object RDate = new { type = "string", format = "date" };
        private static readonly object RLimit = new { type = "integer", minimum = 1, maximum = 100, @default = 25 };
        private static readonly object ROffset = new { type = "integer", minimum = 0, @default = 0 };
        private static readonly object RTop = new { type = "integer", minimum = 1, maximum = 25, @default = 10 };

        private static readonly object SalesSummaryTool = new
        {
            name = "sales_summary",
            description = "Sales report for a period: FBR-filed sale invoices with totals, a month-by-month breakdown, the top customers, and optionally the invoice list. Amounts are in PKR; 'amount' excludes tax.",
            inputSchema = Schema(new
            {
                companyId = RCompanyId, year = RYear, month = RMonth, dateFrom = RDate, dateTo = RDate,
                buyerType = new { type = "string", @enum = BuyerTypes, @default = "all" }, clientId = new { type = "integer", minimum = 1 },
                topClients = RTop, includeInvoices = new { type = "boolean", @default = false }, offset = ROffset, limit = RLimit,
            }, "companyId"),
            annotations = RReadAnnotations,
        };

        private static readonly object OutstandingLedgerTool = new
        {
            name = "outstanding_ledger",
            description = "One client's statement: each bill with amount, paid, balance and status, plus totals and ageing (how old the unpaid balance is). Find the client with search_clients.",
            inputSchema = Schema(new
            {
                companyId = RCompanyId, clientId = new { type = "integer", minimum = 1 },
                status = new { type = "string", @enum = LedgerStatuses, @default = "unpaid" },
                year = RYear, month = RMonth, dateFrom = RDate, dateTo = RDate, offset = ROffset, limit = RLimit,
            }, "companyId", "clientId"),
            annotations = RReadAnnotations,
        };

        private static readonly object ReceivablesByClientTool = new
        {
            name = "receivables_by_client",
            description = "Who owes the company money: the clients with the largest unpaid balances, with how much is overdue and how old the oldest unpaid bill is. Needs permission to see payment status.",
            inputSchema = Schema(new { companyId = RCompanyId, top = RTop, minBalance = new { type = "string", description = "Ignore balances below this amount (PKR)." } }, "companyId"),
            annotations = RReadAnnotations,
        };

        private static readonly object TaxSheetSummaryTool = new
        {
            name = "tax_sheet_summary",
            description = "Tax sheet for a period: invoice lines whose item type still has no valid HS code, grouped by item type, with totals and an optional page of the rows.",
            inputSchema = Schema(new
            {
                companyId = RCompanyId, year = RYear, month = RMonth, dateFrom = RDate, dateTo = RDate, clientId = new { type = "integer", minimum = 1 },
                topItems = RTop, includeRows = new { type = "boolean", @default = false }, offset = ROffset, limit = RLimit,
            }, "companyId"),
            annotations = RReadAnnotations,
        };

        private static readonly object ItemRateHistoryTool = new
        {
            name = "item_rate_history",
            description = "What an item was billed at before: past unit prices with client and date, plus the average, lowest and highest rate across the whole filtered set. Use it to price a quotation.",
            inputSchema = Schema(new
            {
                companyId = RCompanyId, itemTypeId = new { type = "integer", minimum = 1 }, search = new { type = "string", maxLength = 200 },
                clientId = new { type = "integer", minimum = 1 }, dateFrom = RDate, dateTo = RDate,
                page = new { type = "integer", minimum = 1, @default = 1 }, pageSize = RLimit,
            }, "companyId"),
            annotations = RReadAnnotations,
        };

        private static object[] ReportTools() => new[]
        {
            SalesSummaryTool, OutstandingLedgerTool, ReceivablesByClientTool, TaxSheetSummaryTool, ItemRateHistoryTool,
        };

        // ── shared parsing ─────────────────────────────────────────────────

        /// <summary>The report screens' own period rule: a year (with an optional month), or a start and end date together.</summary>
        private static (int? Year, int? Month, DateTime? From, DateTime? To) ReportPeriod(JsonElement args, bool required = true)
        {
            var from = DateArg(args, "dateFrom");
            var to = DateArg(args, "dateTo");
            var year = IntArg(args, "year");
            var month = IntArg(args, "month");
            if (from.HasValue || to.HasValue)
            {
                if (!from.HasValue || !to.HasValue) throw new ToolError("Give both dateFrom and dateTo.");
                if (from.Value.Date > to.Value.Date) throw new ToolError("dateFrom must be on or before dateTo.");
                if ((to.Value - from.Value).TotalDays > 366 * 5) throw new ToolError("Choose a range of at most five years.");
                return (null, null, from, to);
            }
            if (month.HasValue && !year.HasValue) throw new ToolError("month needs a year.");
            if (!year.HasValue)
            {
                if (!required) return (null, null, null, null);
                throw new ToolError("Give a year, or dateFrom and dateTo.");
            }
            if (year < 2000 || year > 2100) throw new ToolError("year must be between 2000 and 2100.");
            if (month.HasValue && (month < 1 || month > 12)) throw new ToolError("month must be between 1 and 12.");
            return (year, month, null, null);
        }

        private static (int Offset, int Limit) Window(JsonElement args) =>
            (Math.Max(0, IntArg(args, "offset") ?? 0), Math.Clamp(IntArg(args, "limit") ?? 25, 1, MaxToolRows));

        private static int Top(JsonElement args, string name) => Math.Clamp(IntArg(args, name) ?? 10, 1, 25);

        private static string Ymd(DateTime d) => d.ToString("yyyy-MM-dd");

        // ── sales_summary ──────────────────────────────────────────────────

        // GET /api/reports/company/{id}/sales: reports.sales.view.
        private async Task<object> SalesSummaryAsync(JsonElement args)
        {
            await Need("reports.sales.view");
            var companyId = await CompanyArg(args);
            var (year, month, from, to) = ReportPeriod(args);
            var buyer = StrArg(args, "buyerType", 20);
            if (buyer == "") buyer = "all";
            if (!BuyerTypes.Contains(buyer)) throw new ToolError("buyerType must be all, registered or unregistered.");
            var clientId = IntArg(args, "clientId");
            if (clientId.HasValue) throw new ToolError("Client filtering is unavailable for this report in this installation.");

            var r = await _reports.GetSalesReportAsync(companyId, year, month, buyer, from, to);
            var invoices = r.Invoices;
            var byMonth = invoices.GroupBy(i => new { i.DocumentDate.Year, i.DocumentDate.Month }).OrderBy(g => g.Key.Year).ThenBy(g => g.Key.Month)
                .Select(g => new { month = $"{g.Key.Year:0000}-{g.Key.Month:00}", invoiceCount = g.Count(), amount = g.Sum(i => i.TotalAmount), tax = g.Sum(i => i.TotalTax), total = g.Sum(i => i.TotalGross) });
            var topClients = invoices.GroupBy(i => i.Customer).Select(g => new { customer = g.Key, invoiceCount = g.Count(), amount = g.Sum(i => i.TotalAmount), total = g.Sum(i => i.TotalGross) })
                .OrderByDescending(c => c.total).Take(Top(args, "topClients"));
            object? page = null;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("includeInvoices", out var inc) && inc.ValueKind == JsonValueKind.True)
            {
                var (offset, limit) = Window(args);
                page = new
                {
                    offset, limit, totalCount = invoices.Count,
                    items = invoices.OrderBy(i => i.DocumentDate).ThenBy(i => i.DocumentNumber).Skip(offset).Take(limit)
                        .Select(i => new { i.DocumentNumber, date = Ymd(i.DocumentDate), i.Customer, amount = i.TotalAmount, tax = i.TotalTax, total = i.TotalGross, i.LineCount }),
                };
            }
            return new
            {
                company = new { id = r.CompanyId, name = r.CompanyName }, period = new { label = r.PeriodLabel, from = Ymd(r.DateFrom), to = Ymd(r.DateTo) }, buyerType = r.BuyerType,
                totals = new { invoiceCount = r.InvoiceCount, lineCount = r.LineCount, quantity = r.GrandQuantity, amount = r.GrandAmount, discount = r.GrandDiscount, tax = r.GrandTax, total = r.GrandTotal },
                byMonth, topClients, invoices = page, currency = "PKR",
            };
        }

        // ── outstanding_ledger ─────────────────────────────────────────────

        private static string Bucket(int days) => days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";

        // GET /api/reports/company/{id}/outstanding: accounting.reports.view.
        private async Task<object> OutstandingLedgerAsync(JsonElement args)
        {
            await Need("accounting.reports.view");
            var companyId = await CompanyArg(args);
            var client = await ClientInCompanyAsync(args, companyId);
            var status = StrArg(args, "status", 10);
            if (status == "") status = "unpaid";
            if (!LedgerStatuses.Contains(status)) throw new ToolError("status must be unpaid, paid or all.");
            var (year, month, from, to) = ReportPeriod(args, required: false);
            if (year.HasValue && from == null) { from = new DateTime(year.Value, month ?? 1, 1); to = month.HasValue ? from.Value.AddMonths(1).AddDays(-1) : from.Value.AddYears(1).AddDays(-1); }
            return await OperationService<IAccountingReportService>().GetOutstandingDocumentsAsync(companyId, new MyApp.Api.DTOs.ReportFilterDto { From = from, To = to, ClientId = client.Id, Status = status, Page = Math.Max(1, IntArg(args, "page") ?? 1), PageSize = Size(args, "limit") }, true);
        }

        // ── receivables_by_client ──────────────────────────────────────────

        // Built from the bills list the Bills screen uses; needs the same payment visibility it has.
        private async Task<object> ReceivablesByClientAsync(JsonElement args)
        {
            await Need("accounting.reports.view");
            var companyId = await CompanyArg(args);
            if (!await CanSeePaymentAsync()) throw new ToolError("Payment status is not visible to this user.");
            var top = Top(args, "top");
            decimal minBalance = 0;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("minBalance", out var mb)) minBalance = Dec(mb, "minBalance", 0m, 999_999_999_999m, 2);

            var bills = (await _invoices.GetByCompanyAsync(companyId))
                .Where(i => i.CompanyId == companyId && !i.IsCancelled && (i.DocumentType == null || i.DocumentType == 4) && i.BalanceDue > 0m).ToList();
            var today = PakistanClock.Today;
            var rows = bills.GroupBy(i => new { i.ClientId, i.ClientName }).Select(g => new
            {
                clientId = g.Key.ClientId, clientName = g.Key.ClientName, unpaidBills = g.Count(),
                balance = g.Sum(i => i.BalanceDue),
                overdue = g.Where(i => i.PaymentStatus == "Overdue").Sum(i => i.BalanceDue),
                oldestUnpaidDate = Ymd(g.Min(i => i.Date)), oldestUnpaidDays = Math.Max(0, (today - g.Min(i => i.Date).Date).Days),
            }).Where(c => c.balance >= minBalance).OrderByDescending(c => c.balance).ToList();
            return new
            {
                companyId, totals = new { clientsOwing = rows.Count, unpaidBills = rows.Sum(c => c.unpaidBills), balance = rows.Sum(c => c.balance), overdue = rows.Sum(c => c.overdue) },
                topClients = rows.Take(top), currency = "PKR",
            };
        }

        // ── tax_sheet_summary ──────────────────────────────────────────────

        // GET /api/reports/company/{id}/tax-sheet: reports.taxsheet.view.
        private async Task<object> TaxSheetSummaryAsync(JsonElement args)
        {
            await Need("reports.taxsheet.view");
            var companyId = await CompanyArg(args);
            var (year, month, from, to) = ReportPeriod(args);
            var clientId = IntArg(args, "clientId");
            if (clientId.HasValue) throw new ToolError("Client filtering is unavailable for this report in this installation.");
            var r = await _reports.GetTaxSheetAsync(companyId, year, month, from, to);
            var byItem = r.Rows.GroupBy(x => x.ItemTypeName).Select(g => new
            {
                itemType = g.Key, lines = g.Count(), invoices = g.Select(x => x.DocumentNumber).Distinct().Count(),
                excluding = g.Sum(x => x.ExcludingAmount), tax = g.Sum(x => x.SalesTax), total = g.Sum(x => x.Total),
            }).OrderByDescending(x => x.total).Take(Top(args, "topItems"));
            object? page = null;
            if (args.ValueKind == JsonValueKind.Object && args.TryGetProperty("includeRows", out var inc) && inc.ValueKind == JsonValueKind.True)
            {
                var (offset, limit) = Window(args);
                page = new
                {
                    offset, limit, totalCount = r.Rows.Count,
                    items = r.Rows.OrderBy(x => x.DocumentDate).ThenBy(x => x.DocumentNumber).Skip(offset).Take(limit)
                        .Select(x => new { x.DocumentNumber, date = Ymd(x.DocumentDate), party = x.PartyName, x.ItemTypeName, x.QuantityLabel, excluding = x.ExcludingAmount, tax = x.SalesTax, x.Total }),
                };
            }
            return new
            {
                company = new { id = r.CompanyId, name = r.CompanyName }, period = new { label = r.PeriodLabel, from = Ymd(r.DateFrom), to = Ymd(r.DateTo) },
                totals = new { invoicesNeedingHsCode = r.InvoiceCount, lines = r.RowCount, excluding = r.GrandExcluding, tax = r.GrandTax, total = r.GrandTotal },
                byItemType = byItem, rows = page, currency = "PKR",
            };
        }

        // ── item_rate_history ──────────────────────────────────────────────

        // GET /api/invoices/company/{id}/item-rate-history: itemratehistory.view.
        private async Task<object> ItemRateHistoryAsync(JsonElement args)
        {
            await Need("itemratehistory.view");
            var companyId = await CompanyArg(args);
            var itemTypeId = await ItemTypeInCompanyAsync(args, companyId);
            if (IntArg(args, "clientId").HasValue) await ClientInCompanyAsync(args, companyId);
            var size = PaginationHelper.Clamp(Size(args, "pageSize"), 25);
            var page = PaginationHelper.ClampPage(IntArg(args, "page") ?? 1);
            var r = await _invoices.GetItemRateHistoryAsync(companyId, page, size, itemTypeId, StrArg(args, "search"), IntArg(args, "clientId"), DateArg(args, "dateFrom"), DateArg(args, "dateTo"));
            return new
            {
                summary = new { count = r.TotalCount, average = r.AvgUnitPrice, lowest = r.MinUnitPrice, highest = r.MaxUnitPrice, currency = "PKR" },
                items = r.Items.Select(x => new { x.InvoiceId, x.InvoiceNumber, date = Ymd(x.Date), x.ClientId, x.ClientName, x.ItemTypeId, x.ItemTypeName, x.Description, x.Quantity, unit = x.UOM, x.UnitPrice, x.LineTotal }),
                page = r.Page, pageSize = r.PageSize, totalPages = (int)Math.Ceiling(r.TotalCount / (double)Math.Max(1, r.PageSize)),
            };
        }
    }
}
