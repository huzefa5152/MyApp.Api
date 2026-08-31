using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Management summaries — the month-by-month view, and cash flow.
    ///
    /// These are deliberately thin: every figure already exists in an engine built
    /// in an earlier phase, so these reports arrange rather than compute. Revenue
    /// and expense summaries read the ledger (the same source as the P&amp;L), the
    /// monthly series read the document registers and the expense engine, and cash
    /// flow reads the bank and cash accounts. Nothing is re-derived, so a management
    /// summary and the statement it summarises cannot disagree.
    ///
    /// ── What is NOT here ──
    /// Gross Profit, Net Profit by period, Customer Profitability and Monthly Profit
    /// need the cost of the goods sold, and selling stock does not currently relieve
    /// inventory (see FEATURE_ACCOUNTING_REPORTS.md §2). They are listed in the UI as
    /// Blocked with the reason on the card, rather than shipped as a number that
    /// looks like profit and is not.
    /// </summary>
    public partial class AccountingReportService
    {
        // ── Revenue / expense summary ─────────────────────────────────────────────

        /// <summary>
        /// Income or expense by account for the period, straight from the ledger —
        /// the P&amp;L's figures without the statement hierarchy, for when the question
        /// is "which accounts, largest first" rather than "how does it lay out".
        /// </summary>
        public async Task<ReportResultDto> GetRevenueExpenseSummaryAsync(int companyId,
            ReportFilterDto filter, bool income)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId,
                income ? "Revenue Summary" : "Expense Summary (by account)",
                window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", "Account"),
                Col("group", "Group"),
                Col("amount", income ? "Revenue" : "Expense", "money", totalled: true),
                Col("count", "Transactions", "int"),
            };

            if (!glOn)
            {
                report.Notice = "These figures come from the general ledger, which is off for this "
                              + "company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var type = income ? AccountType.Income : AccountType.Expense;
            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && l.Account.AccountType == type);
            q = ScopeToDivisions(q, filter);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == filter.DivisionId!.Value
                              || l.DivisionId == filter.DivisionId!.Value);
            if (filter.AccountGroupId.HasValue)
                q = q.Where(l => l.Account.AccountGroupId == filter.AccountGroupId!.Value);

            var grouped = await q
                .GroupBy(l => new { l.AccountId, Name = l.Account.Name, l.Account.AccountGroupId })
                .Select(g => new
                {
                    g.Key.AccountId, g.Key.Name, g.Key.AccountGroupId,
                    // Income is credit-natural, expense debit-natural: take the side
                    // that represents value so both read positive.
                    Amount = g.Sum(x => income ? x.Credit - x.Debit : x.Debit - x.Credit),
                    Count = g.Select(x => x.JournalEntryId).Distinct().Count(),
                })
                .ToListAsync();

            var groupIds = grouped.Select(g => g.AccountGroupId).Distinct().ToList();
            var groupNames = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId && groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id, g => g.Name);

            var rows = grouped
                .Where(g => g.Amount != 0m)
                .OrderByDescending(g => g.Amount)
                .Select(g => (object)new
                {
                    label = g.Name,
                    group = groupNames.GetValueOrDefault(g.AccountGroupId),
                    amount = g.Amount,
                    count = g.Count,
                    accountId = g.AccountId,
                })
                .ToList();

            report.Rows = rows;
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["amount"] = grouped.Sum(g => g.Amount);
            report.Totals["accounts"] = rows.Count;
            report.TotalLabels["amount"] = income ? "Total Revenue" : "Total Expenses";
            report.TotalLabels["accounts"] = "Accounts";

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = income ? "Revenue by account" : "Expenses by account",
                DrillFilter = "accountId",
                Rows = grouped.Where(g => g.Amount != 0m)
                    .OrderByDescending(g => g.Amount)
                    .Select(g => new ReportGroupRowDto
                    {
                        DrillKey = g.AccountId.ToString(),
                        Label = g.Name, Amount = g.Amount, Count = g.Count,
                    }).ToList(),
                Total = grouped.Sum(g => g.Amount),
            });
            return report;
        }

        // ── Monthly expenses ──────────────────────────────────────────────────────

        /// <summary>Month-by-month spend. Delegates to the expense engine so it
        /// agrees with the Company Expense Report exactly.</summary>
        public Task<ReportResultDto> GetMonthlyExpensesAsync(int companyId, ReportFilterDto filter) =>
            GetExpenseSummaryAsync(companyId, filter, "month");

        // ── Cash flow summary ─────────────────────────────────────────────────────

        /// <summary>
        /// Money in, money out and the net movement, by month, across the bank and
        /// cash accounts.
        ///
        /// This is a CASH MOVEMENT summary, not a IAS-7 statement of cash flows: it
        /// does not classify movements into operating, investing and financing. The
        /// <c>CashFlowClass</c> column exists on the account but is unset for every
        /// seeded account, so classifying would mean guessing. The report says so
        /// rather than implying a statutory cash-flow statement.
        /// </summary>
        public async Task<ReportResultDto> GetCashFlowSummaryAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Cash Flow Summary", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", "Month"),
                Col("opening", "Opening", "money"),
                Col("moneyIn", "Money in", "money", totalled: true),
                Col("moneyOut", "Money out", "money", totalled: true),
                Col("net", "Net movement", "money", totalled: true),
                Col("closing", "Closing", "money"),
            };

            if (!glOn)
            {
                report.Notice = "Cash flow is built from the bank and cash accounts in the general "
                              + "ledger, which is off for this company.";
                return report;
            }

            var accounts = await LoadCashBankAccountsAsync(companyId, "all");
            if (accounts.Count == 0)
            {
                report.Notice = "No bank or cash accounts are set up yet.";
                return report;
            }
            var ids = accounts.Select(a => a.Id).ToList();

            var q = ScopeToDivisions(_context.JournalLines.AsNoTracking()
                .Where(l => ids.Contains(l.AccountId) && l.JournalEntry.CompanyId == companyId), filter);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == filter.DivisionId!.Value
                              || l.DivisionId == filter.DivisionId!.Value);

            var monthly = (await q
                .GroupBy(l => new { l.JournalEntry.Date.Year, l.JournalEntry.Date.Month })
                .Select(g => new
                {
                    g.Key.Year, g.Key.Month,
                    In = g.Sum(x => x.Debit), Out = g.Sum(x => x.Credit),
                })
                .ToListAsync())
                .Select(x => new { Sort = new DateTime(x.Year, x.Month, 1), x.In, x.Out })
                .OrderBy(x => x.Sort)
                .ToList();

            // The opening balance for the first month, carried forward month to month
            // so each row reads as a bank statement does. Uses the GL balance
            // primitive for the starting figure.
            var first = monthly.FirstOrDefault();
            var runningOpen = first == null ? 0m
                : await OpeningForAccountsAsync(companyId, ids, first.Sort);

            var rows = new List<object>();
            foreach (var m in monthly)
            {
                var net = m.In - m.Out;
                var closing = runningOpen + net;
                rows.Add(new
                {
                    label = m.Sort.ToString("MMM yyyy"),
                    opening = runningOpen,
                    moneyIn = m.In,
                    moneyOut = m.Out,
                    net,
                    closing,
                    drillKey = m.Sort.ToString("yyyy-MM-dd"),
                });
                runningOpen = closing;
            }

            report.Rows = rows;
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["moneyIn"] = monthly.Sum(m => m.In);
            report.Totals["moneyOut"] = monthly.Sum(m => m.Out);
            report.Totals["net"] = monthly.Sum(m => m.In - m.Out);
            report.Totals["closing"] = runningOpen;
            report.TotalLabels["moneyIn"] = "Total In";
            report.TotalLabels["moneyOut"] = "Total Out";
            report.TotalLabels["net"] = "Net Movement";
            report.TotalLabels["closing"] = "Closing Cash";

            report.Notice = "This is a summary of cash movement by month. It is not a statutory "
                          + "statement of cash flows — movements are not split into operating, "
                          + "investing and financing, because the accounts carry no such "
                          + "classification to split them by.";
            return report;
        }
    }
}
