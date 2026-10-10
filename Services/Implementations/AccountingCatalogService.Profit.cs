using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs.AccountingCatalog;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Profit reports — Gross Profit, Monthly Profit and Customer Profitability.
    ///
    /// ── Why these can exist now ──
    /// Since 2026-09-23 every sale in a stock-tracking company carries its cost in
    /// its own journal entry (Dr Cost of goods sold / Cr Inventory on hand,
    /// reversed for a credit note — <c>PostingService.AddInventoryReliefAsync</c>),
    /// so revenue and its matched cost both live in <c>JournalLines</c>.
    ///
    /// ── None of them computes anything of its own ──
    /// "Revenue" is the P&amp;L's income section and "cost of sales" its Cost of
    /// Sales section, resolved by <see cref="PlSectionByAccount"/> — the same
    /// classification the Profit &amp; Loss itself runs on — and every figure is a
    /// sum over <see cref="PeriodLinesQuery"/>, the P&amp;L's own window rule. So:
    ///   • Gross Profit IS the top of the P&amp;L, line for line;
    ///   • each Monthly Profit row is the P&amp;L for that month, and the column
    ///     totals are the P&amp;L for the range;
    ///   • Customer Profitability splits the same two figures by customer, and
    ///     whatever is not a customer's sale (a manual journal, a discount, a
    ///     purchase expensed straight to cost of sales, a bill withdrawn at FBR)
    ///     is shown as its own row rather than left as an unexplained gap.
    /// </summary>
    public partial class AccountingCatalogService
    {
        private const string UnattributedLabel = "Not attributed to a customer";

        // ── Gross Profit ──────────────────────────────────────────────────────────

        public async Task<StatementResultDto> GetGrossProfitAsync(int companyId,
            ReportFilterDto filter, bool comparative)
        {
            var window = ResolveWindow(filter);
            var glOn = await _gl.IsEnabledAsync(companyId);

            var (priorFrom, priorTo) = comparative ? PriorPeriod(window) : (null, null);
            var hasComparative = comparative && priorFrom.HasValue;

            var report = await NewStatementAsync(companyId, "Gross Profit", window, filter,
                glOn, "GrossProfit", window.To,
                hasComparative ? $"{priorFrom:d MMM yyyy} – {priorTo:d MMM yyyy}" : null);

            if (!glOn)
            {
                report.Notice = "Gross profit is built from the general ledger, which is off for "
                              + "this company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }
            if (comparative && !hasComparative)
                report.Notice = "A comparative needs a bounded period — All Periods has nothing to "
                              + "compare against. Pick a month, quarter or year.";

            var (groups, accounts) = await LoadChartAsync(companyId);
            if (groups.Count == 0)
            {
                report.Notice = "This company has no chart of accounts yet.";
                return report;
            }

            var now = await MovementByAccountAsync(companyId, filter, window.From, window.To);
            var then = hasComparative
                ? await MovementByAccountAsync(companyId, filter, priorFrom, priorTo)
                : null;

            // The income and Cost of Sales sections of the P&L, laid out by the
            // same builder, in the same order. Expense sections are left out — they
            // sit below gross profit.
            var lines = new List<StatementLineDto>();
            decimal income = 0, cost = 0, pIncome = 0, pCost = 0;
            foreach (var (root, kind) in ClassifyProfitAndLossRoots(groups, accounts))
            {
                if (kind == PlSection.Expenses) continue;
                var sign = kind == PlSection.Income ? -1m : 1m;
                var section = BuildStatementSection(root, groups, accounts, now, then, sign, level: 0);
                lines.AddRange(section.Lines);
                lines.Add(Subtotal($"Total {root.Name}", 0, section.Total,
                    then == null ? null : section.Comparative ?? 0m));
                lines.Add(new StatementLineDto { Kind = "spacer" });
                if (kind == PlSection.Income) { income += section.Total; pIncome += section.Comparative ?? 0m; }
                else { cost += section.Total; pCost += section.Comparative ?? 0m; }
            }

            var gross = income - cost;
            var pGross = pIncome - pCost;
            lines.Add(Total("Gross profit", gross, then == null ? null : pGross));

            var margin = MarginPercent(gross, income);
            var pMargin = then == null ? null : MarginPercent(pGross, pIncome);
            // A margin on no revenue is not a number, so a period without revenue
            // leaves its cell blank rather than printing a flattering 0%.
            if (margin.HasValue)
                lines.Add(new StatementLineDto
                {
                    Kind = "ratio", Label = "Gross margin %",
                    Amount = margin.Value,
                    Comparative = pMargin,
                    Change = pMargin.HasValue ? margin.Value - pMargin.Value : null,
                });

            report.TotalIncome = income;
            report.TotalCostOfSales = cost;
            report.GrossProfit = gross;
            report.GrossProfitMeaningful = cost != 0m;
            report.GrossMarginPercent = margin;

            FinishStatement(report, lines, hasComparative, priorTo);
            report.Totals["revenue"] = income;
            report.Totals["costOfSales"] = cost;
            report.Totals["grossProfit"] = gross;
            report.TotalLabels["revenue"] = "Revenue";
            report.TotalLabels["costOfSales"] = "Cost of Sales";
            report.TotalLabels["grossProfit"] = "Gross Profit";
            if (margin.HasValue)
            {
                report.Totals["grossMarginPercent"] = margin.Value;
                report.TotalLabels["grossMarginPercent"] = "Gross Margin";
            }

            AppendNotice(report, await CostOfSalesNoteAsync(companyId));
            return report;
        }

        // ── Monthly Profit ────────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetMonthlyProfitAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _gl.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Monthly Profit", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", "Month"),
                Col("revenue", "Revenue", "money", totalled: true),
                Col("costOfSales", "Cost of sales", "money", totalled: true),
                Col("grossProfit", "Gross profit", "money", totalled: true),
                Col("grossMarginPercent", "Gross margin", "percent"),
                Col("otherExpenses", "Other expenses", "money", totalled: true),
                Col("netProfit", "Net profit", "money", totalled: true),
            };

            if (!glOn)
            {
                report.Notice = "Monthly profit is built from the general ledger, which is off for "
                              + "this company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var (groups, accounts) = await LoadChartAsync(companyId);
            if (groups.Count == 0)
            {
                report.Notice = "This company has no chart of accounts yet.";
                return report;
            }
            var sections = PlSectionByAccount(groups, accounts);
            var plAccountIds = sections.Keys.ToList();

            // One grouped query rather than one P&L per month. It sums the very
            // same lines (PeriodLinesQuery, the P&L's window rule) bucketed by the
            // entry's calendar month — and the entry date is already the
            // document's Pakistan date, which is what ReportPeriod's month
            // boundaries are drawn on.
            var monthly = await PeriodLinesQuery(companyId, window.From, window.To)
                .Where(l => plAccountIds.Contains(l.AccountId))
                .GroupBy(l => new { l.JournalEntry.Date.Year, l.JournalEntry.Date.Month, l.AccountId })
                .Select(g => new
                {
                    g.Key.Year, g.Key.Month, g.Key.AccountId,
                    Net = g.Sum(x => x.Debit - x.Credit),
                })
                .ToListAsync();

            // Which months to list. A bounded window lists every month it touches —
            // a month with no trading is a fact worth seeing in a trend. All Periods
            // runs from the first month with P&L activity to the last.
            DateTime? first = window.From, last = window.To;
            if (!first.HasValue || !last.HasValue)
            {
                var dated = monthly.Select(m => new DateTime(m.Year, m.Month, 1)).ToList();
                if (dated.Count > 0)
                {
                    first ??= dated.Min();
                    last ??= dated.Max().AddMonths(1).AddDays(-1);
                }
            }

            var rows = new List<MonthlyProfitRowDto>();
            if (first.HasValue && last.HasValue && first.Value <= last.Value)
            {
                for (var m = new DateTime(first.Value.Year, first.Value.Month, 1);
                     m <= last.Value; m = m.AddMonths(1))
                {
                    var monthStart = m;
                    var monthEnd = m.AddMonths(1).AddDays(-1);
                    var from = monthStart < first.Value ? first.Value : monthStart;
                    var to = monthEnd > last.Value ? last.Value : monthEnd;

                    var movement = monthly
                        .Where(x => x.Year == m.Year && x.Month == m.Month)
                        .ToDictionary(x => x.AccountId, x => x.Net);
                    var t = SumProfitAndLoss(sections, movement);

                    var whole = from == monthStart && to == monthEnd;
                    rows.Add(new MonthlyProfitRowDto
                    {
                        Label = whole ? m.ToString("MMM yyyy")
                              : $"{m:MMM yyyy} ({from:d MMM} – {to:d MMM})",
                        From = from,
                        To = to,
                        Revenue = t.Income,
                        CostOfSales = t.CostOfSales,
                        GrossProfit = t.GrossProfit,
                        GrossMarginPercent = MarginPercent(t.GrossProfit, t.Income),
                        OtherExpenses = t.Expenses,
                        NetProfit = t.NetProfit,
                    });
                }
            }

            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;

            var revenue = rows.Sum(r => r.Revenue);
            var grossTotal = rows.Sum(r => r.GrossProfit);
            report.Totals["revenue"] = revenue;
            report.Totals["costOfSales"] = rows.Sum(r => r.CostOfSales);
            report.Totals["grossProfit"] = grossTotal;
            report.Totals["otherExpenses"] = rows.Sum(r => r.OtherExpenses);
            report.Totals["netProfit"] = rows.Sum(r => r.NetProfit);
            report.TotalLabels["revenue"] = "Revenue";
            report.TotalLabels["costOfSales"] = "Cost of Sales";
            report.TotalLabels["grossProfit"] = "Gross Profit";
            report.TotalLabels["otherExpenses"] = "Other Expenses";
            report.TotalLabels["netProfit"] = "Net Profit";
            if (MarginPercent(grossTotal, revenue) is { } margin)
            {
                report.Totals["grossMarginPercent"] = margin;
                report.TotalLabels["grossMarginPercent"] = "Gross Margin";
            }

            AppendNotice(report, await CostOfSalesNoteAsync(companyId));
            return report;
        }

        // ── Customer Profitability ────────────────────────────────────────────────

        public async Task<ReportResultDto> GetCustomerProfitabilityAsync(int companyId,
            ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _gl.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Customer Profitability", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("customer", "Customer"),
                Col("invoices", "Invoices", "int"),
                Col("revenue", "Revenue", "money", totalled: true),
                Col("costOfSales", "Cost of sales", "money", totalled: true),
                Col("grossProfit", "Gross profit", "money", totalled: true),
                Col("marginPercent", "Margin", "percent"),
            };
            report.RowDrillFilter = "clientId";

            if (!glOn)
            {
                report.Notice = "Customer profitability is built from the general ledger, which is "
                              + "off for this company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var (groups, accounts) = await LoadChartAsync(companyId);
            if (groups.Count == 0)
            {
                report.Notice = "This company has no chart of accounts yet.";
                return report;
            }
            var sections = PlSectionByAccount(groups, accounts);
            var plAccountIds = sections.Keys.ToList();

            // The whole period's P&L movement — the figure the rows must add up to.
            var movement = await MovementByAccountAsync(companyId, filter, window.From, window.To);
            var pl = SumProfitAndLoss(sections, movement);

            // A sale document's entry carries BOTH halves of the sale: its revenue
            // legs and its inventory-relief legs. Attribute each line through the
            // entry's source document to the invoice, and from the invoice to its
            // customer. Every join is pinned to this company on both sides.
            //
            // Demo, voided and FBR-withdrawn bills are not a customer's sale — the
            // exclusions every sales report applies. A demo or voided bill never
            // reaches the ledger; a bill withdrawn at FBR keeps its entry, so its
            // figures land in the unattributed row instead of on the customer.
            var attributed = await (
                from l in PeriodLinesQuery(companyId, window.From, window.To)
                where l.JournalEntry.SourceDocType == SourceDocType.Invoice
                      && plAccountIds.Contains(l.AccountId)
                join inv in _context.Invoices.AsNoTracking()
                    on l.JournalEntry.SourceDocId equals (int?)inv.Id
                where inv.CompanyId == companyId
                      && !inv.IsDemo && !inv.IsCancelled && inv.FbrCancelledAt == null
                      && inv.Client.CompanyId == companyId
                select new
                {
                    l.AccountId,
                    Net = l.Debit - l.Credit,
                    InvoiceId = inv.Id,
                    inv.ClientId,
                    inv.Client.ClientGroupId,
                    inv.DocumentType,
                })
                .ToListAsync();

            var names = (await _context.Clients.AsNoTracking()
                    .Where(c => c.CompanyId == companyId)
                    .Select(c => new { c.Id, c.Name })
                    .ToListAsync())
                .ToDictionary(c => c.Id, c => c.Name);

            // §5 grouping: one legal entity kept under two client records reads as
            // one customer. A group's rows are always this company's own clients
            // (the join above), so a name is taken from them, never from the
            // cross-tenant group label.
            var rows = new List<CustomerProfitRowDto>();
            foreach (var g in attributed.GroupBy(x => x.ClientGroupId ?? -x.ClientId))
            {
                var bySection = g.GroupBy(x => x.AccountId)
                    .ToDictionary(x => x.Key, x => x.Sum(y => y.Net));
                var t = SumProfitAndLoss(sections, bySection);

                // Lead with the client record carrying the most revenue: it is the
                // one the ledger drill opens.
                var clients = g.GroupBy(x => x.ClientId)
                    .Select(c => new
                    {
                        ClientId = c.Key,
                        Revenue = -c.Where(x => sections[x.AccountId] == PlSection.Income).Sum(x => x.Net),
                    })
                    .OrderByDescending(c => c.Revenue).ThenBy(c => c.ClientId)
                    .ToList();
                var lead = clients[0].ClientId;
                var name = names.GetValueOrDefault(lead) ?? $"Customer #{lead}";

                rows.Add(new CustomerProfitRowDto
                {
                    ClientId = lead,
                    ClientIds = clients.Select(c => c.ClientId).ToList(),
                    DrillKey = lead.ToString(),
                    Customer = clients.Count > 1 ? $"{name} ({clients.Count} client records)" : name,
                    // Sale invoices only — a credit or debit note adjusts an
                    // invoice already counted.
                    Invoices = g.Where(x => x.DocumentType != 9 && x.DocumentType != 10)
                        .Select(x => x.InvoiceId).Distinct().Count(),
                    Notes = g.Where(x => x.DocumentType == 9 || x.DocumentType == 10)
                        .Select(x => x.InvoiceId).Distinct().Count(),
                    Revenue = t.Income,
                    CostOfSales = t.CostOfSales,
                    GrossProfit = t.GrossProfit,
                    MarginPercent = MarginPercent(t.GrossProfit, t.Income),
                });
            }

            rows = rows
                .OrderByDescending(r => r.GrossProfit)
                .ThenByDescending(r => r.Revenue)
                .ThenBy(r => r.Customer, StringComparer.OrdinalIgnoreCase)
                .ToList();

            // The tie-out row. Whatever the P&L holds that is not a customer's sale
            // is named here, so customers + this row = the P&L exactly.
            var custRevenue = rows.Sum(r => r.Revenue);
            var custCost = rows.Sum(r => r.CostOfSales);
            var restRevenue = pl.Income - custRevenue;
            var restCost = pl.CostOfSales - custCost;
            if (restRevenue != 0m || restCost != 0m)
            {
                rows.Add(new CustomerProfitRowDto
                {
                    Customer = UnattributedLabel,
                    IsUnattributed = true,
                    Revenue = restRevenue,
                    CostOfSales = restCost,
                    GrossProfit = restRevenue - restCost,
                    MarginPercent = MarginPercent(restRevenue - restCost, restRevenue),
                });
            }

            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["revenue"] = pl.Income;
            report.Totals["costOfSales"] = pl.CostOfSales;
            report.Totals["grossProfit"] = pl.GrossProfit;
            report.Totals["customerCount"] = rows.Count(r => !r.IsUnattributed);
            report.TotalLabels["revenue"] = "Revenue";
            report.TotalLabels["costOfSales"] = "Cost of Sales";
            report.TotalLabels["grossProfit"] = "Gross Profit";
            report.TotalLabels["customerCount"] = "Customers";
            if (MarginPercent(pl.GrossProfit, pl.Income) is { } margin)
            {
                report.Totals["grossMarginPercent"] = margin;
                report.TotalLabels["grossMarginPercent"] = "Gross Margin";
            }

            if (restRevenue != 0m || restCost != 0m)
                AppendNotice(report, $"\"{UnattributedLabel}\" is revenue and cost of sales the Profit & "
                    + "Loss holds that no customer's sale document carries — manual journals, discounts "
                    + "and write-backs, purchases charged straight to cost of sales, and bills withdrawn "
                    + "at FBR. It is shown so the totals tie to the Profit & Loss.");
            AppendNotice(report, await CostOfSalesNoteAsync(companyId));
            return report;
        }
    }
}
