using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Financial statements — Balance Sheet, Profit &amp; Loss, General Ledger,
    /// Account Balance Summary, Trial Balance.
    ///
    /// ── What was actually missing ──
    /// The product appeared to have a Balance Sheet and a P&amp;L. What it had was
    /// the Chart of Accounts tree split into the two statement sections with
    /// all-time balances (<c>AccountService.GetCoaTreeAsync</c>) — no period, no
    /// comparatives, no balance check. These are the statements.
    ///
    /// ── Structure vs figures ──
    /// The hierarchy comes from <c>AccountGroup</c> (groups nest, each carries its
    /// statement). The figures come from
    /// <see cref="IGeneralLedgerService.GetAccountBalancesAsync"/> for a balance
    /// sheet (a position at a date) and from journal-line movement for a P&amp;L (a
    /// flow across a period). Neither is recomputed here.
    ///
    /// ── Why the balance sheet balances ──
    /// P&amp;L accounts are never closed out, so a company's profit lives in the
    /// income and expense accounts rather than in equity. Without help, Assets
    /// would exceed Liabilities + Equity by exactly the net profit. The fix is the
    /// same synthetic "Current-Year Earnings" line the Chart of Accounts tree
    /// already injects into Equity — reused deliberately, so the statement and the
    /// CoA can never disagree about equity.
    ///
    /// ── Sign ──
    /// Every figure is emitted in its natural reading direction: assets and
    /// expenses positive as debits, liabilities, equity and income positive as
    /// credits. The ledger is debit-positive throughout, so credit-natural lines
    /// are negated exactly once, here, at the point of presentation.
    /// </summary>
    public partial class AccountingReportService
    {
        private static readonly List<ReportColumnDto> StatementColumns = new()
        {
            Col("label", "", "text"),
            Col("amount", "Amount", "money"),
        };

        private static List<ReportColumnDto> StatementColumnsWithComparative(string label) => new()
        {
            Col("label", "", "text"),
            Col("amount", "Amount", "money"),
            Col("comparative", label, "money"),
            Col("change", "Change", "money"),
        };

        // ── Balance Sheet ─────────────────────────────────────────────────────────

        public async Task<StatementResultDto> GetBalanceSheetAsync(int companyId,
            ReportFilterDto filter, bool comparative)
        {
            var window = ResolveWindow(filter);
            // A balance sheet is a position at a moment. Only the END of the period
            // matters; "from" is meaningless for it.
            var asOf = window.To ?? PakistanClock.Today;
            // Comparative: the same date one year earlier. A year is the convention
            // and it is what makes seasonal businesses comparable.
            var priorAsOf = asOf.AddYears(-1);

            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewStatementAsync(companyId, "Balance Sheet", window, filter,
                glOn, "BalanceSheet", asOf,
                comparative ? $"As at {priorAsOf:d MMM yyyy}" : null);
            report.PeriodLabel = $"As at {asOf:d MMM yyyy}";

            if (!glOn)
            {
                report.Notice = "A balance sheet is built from the general ledger, which is off for "
                              + "this company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var (groups, accounts) = await LoadChartAsync(companyId);
            if (groups.Count == 0)
            {
                report.Notice = "This company has no chart of accounts yet.";
                return report;
            }

            var now = await _gl.GetAccountBalancesAsync(companyId, asOf);
            var then = comparative ? await _gl.GetAccountBalancesAsync(companyId, priorAsOf) : null;

            var lines = new List<StatementLineDto>();
            decimal assets = 0, liabilities = 0, equity = 0;
            decimal pAssets = 0, pLiabilities = 0, pEquity = 0;

            // Net P&L, which becomes the Current-Year Earnings line in equity.
            var plNow = NetOfStatement(groups, accounts, now, FinancialStatement.ProfitAndLoss);
            var plThen = then == null ? 0m
                : NetOfStatement(groups, accounts, then, FinancialStatement.ProfitAndLoss);

            foreach (var root in RootsOf(groups, FinancialStatement.BalanceSheet))
            {
                // Assets are debit-natural; liabilities and equity are credit-natural
                // and so are negated for display.
                var isDebitNatural = IsAssetSection(root, accounts);
                var sign = isDebitNatural ? 1m : -1m;

                var section = BuildStatementSection(root, groups, accounts, now, then, sign, level: 0);
                lines.AddRange(section.Lines);

                var isEquity = root.Name.Contains("equity", StringComparison.OrdinalIgnoreCase);
                var total = section.Total;
                var pTotal = section.Comparative ?? 0m;

                // Current-Year Earnings, injected into equity exactly as the Chart
                // of Accounts tree does it. A profit is a net CREDIT in the ledger
                // (negative debit-positive), which raises equity.
                if (isEquity && (plNow != 0m || plThen != 0m))
                {
                    var earnings = -plNow;
                    var pEarnings = -plThen;
                    lines.Add(new StatementLineDto
                    {
                        Level = 1, Kind = "account", Label = "Current-Year Earnings",
                        Amount = earnings,
                        Comparative = then == null ? null : pEarnings,
                        Change = then == null ? null : earnings - pEarnings,
                    });
                    total += earnings;
                    pTotal += pEarnings;
                }

                lines.Add(Subtotal($"Total {root.Name}", 0, total,
                    then == null ? null : pTotal));
                lines.Add(new StatementLineDto { Kind = "spacer" });

                if (isDebitNatural) { assets += total; pAssets += pTotal; }
                else if (isEquity) { equity += total; pEquity += pTotal; }
                else { liabilities += total; pLiabilities += pTotal; }
            }

            lines.Add(Total("Total assets", assets, then == null ? null : pAssets));
            lines.Add(Total("Total liabilities and equity", liabilities + equity,
                then == null ? null : pLiabilities + pEquity));

            report.TotalAssets = assets;
            report.TotalLiabilities = liabilities;
            report.TotalEquity = equity;
            report.Difference = assets - (liabilities + equity);
            report.IsBalanced = Math.Abs(report.Difference.Value) < 0.01m;

            if (!report.IsBalanced)
            {
                // Say it on the face of the statement. A balance sheet that silently
                // does not balance is worse than no balance sheet.
                lines.Add(new StatementLineDto
                {
                    Kind = "total", Label = "Out of balance by", Amount = report.Difference.Value,
                });
                report.Notice = $"This balance sheet is out of balance by "
                              + $"{Math.Abs(report.Difference.Value):N2}. Check Accounting → Dashboard "
                              + "for the ledger health figures, and the Suspense account for postings "
                              + "that could not be resolved.";
            }

            FinishStatement(report, lines, comparative, priorAsOf);
            report.Totals["totalAssets"] = assets;
            report.Totals["totalLiabilities"] = liabilities;
            report.Totals["totalEquity"] = equity;
            report.TotalLabels["totalAssets"] = "Total Assets";
            report.TotalLabels["totalLiabilities"] = "Liabilities";
            report.TotalLabels["totalEquity"] = "Equity";
            return report;
        }

        // ── Profit & Loss ─────────────────────────────────────────────────────────

        public async Task<StatementResultDto> GetProfitAndLossAsync(int companyId,
            ReportFilterDto filter, bool comparative)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);

            // Comparative: the immediately preceding period of the SAME length, so
            // a month compares to a month and a quarter to a quarter.
            DateTime? priorFrom = null, priorTo = null;
            if (comparative && window.From.HasValue && window.To.HasValue)
            {
                var days = (window.To.Value - window.From.Value).Days + 1;
                priorTo = window.From.Value.AddDays(-1);
                priorFrom = priorTo.Value.AddDays(-(days - 1));
            }
            var hasComparative = comparative && priorFrom.HasValue;

            var report = await NewStatementAsync(companyId, "Profit & Loss", window, filter,
                glOn, "ProfitAndLoss", window.To,
                hasComparative ? $"{priorFrom:d MMM yyyy} – {priorTo:d MMM yyyy}" : null);

            if (!glOn)
            {
                report.Notice = "A profit & loss statement is built from the general ledger, which is "
                              + "off for this company. Enable GL posting in Accounting → Dashboard.";
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

            var lines = new List<StatementLineDto>();
            decimal income = 0, costOfSales = 0, expenses = 0;
            decimal pIncome = 0, pCostOfSales = 0, pExpenses = 0;
            var costSectionSeen = false;

            foreach (var root in RootsOf(groups, FinancialStatement.ProfitAndLoss))
            {
                var isIncome = SectionIsIncome(root, accounts);
                // Income is credit-natural, so negate for display; costs and
                // expenses are debit-natural and pass through.
                var sign = isIncome ? -1m : 1m;

                var section = BuildStatementSection(root, groups, accounts, now, then, sign, level: 0);
                lines.AddRange(section.Lines);
                var total = section.Total;
                var pTotal = section.Comparative ?? 0m;
                lines.Add(Subtotal($"Total {root.Name}", 0, total, then == null ? null : pTotal));

                var isCost = IsCostOfSalesSection(root);
                if (isIncome) { income += total; pIncome += pTotal; }
                else if (isCost) { costOfSales += total; pCostOfSales += pTotal; costSectionSeen = true; }
                else { expenses += total; pExpenses += pTotal; }

                // Gross profit belongs immediately after cost of sales, where a
                // reader expects it — but only when there is a cost to subtract.
                if (isCost && (costOfSales != 0m || pCostOfSales != 0m))
                {
                    lines.Add(new StatementLineDto { Kind = "spacer" });
                    lines.Add(Total("Gross profit", income - costOfSales,
                        then == null ? null : pIncome - pCostOfSales));
                }
                lines.Add(new StatementLineDto { Kind = "spacer" });
            }

            var net = income - costOfSales - expenses;
            var pNet = pIncome - pCostOfSales - pExpenses;
            lines.Add(Total("Net profit", net, then == null ? null : pNet));

            report.TotalIncome = income;
            report.TotalCostOfSales = costOfSales;
            report.TotalExpenses = expenses;
            report.NetProfit = net;
            report.GrossProfitMeaningful = costSectionSeen && costOfSales != 0m;
            report.GrossProfit = report.GrossProfitMeaningful ? income - costOfSales : null;

            FinishStatement(report, lines, hasComparative, priorTo);
            report.Totals["income"] = income;
            report.Totals["expenses"] = costOfSales + expenses;
            report.Totals["netProfit"] = net;
            report.TotalLabels["income"] = "Income";
            report.TotalLabels["expenses"] = "Cost & Expenses";
            report.TotalLabels["netProfit"] = "Net Profit";
            if (report.GrossProfitMeaningful)
            {
                report.Totals["grossProfit"] = report.GrossProfit!.Value;
                report.TotalLabels["grossProfit"] = "Gross Profit";
            }

            // The COGS caveat, stated on the statement rather than left to be
            // discovered. Selling stock does not currently relieve inventory, so a
            // company that tracks stock has revenue with no matched cost.
            var tracksInventory = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.InventoryTrackingEnabled)
                .FirstOrDefaultAsync();
            if (tracksInventory && income != 0m)
            {
                var note = "This company tracks inventory, and a sale does not yet move the cost of "
                         + "the goods out of stock. Purchases are held as inventory on the balance "
                         + "sheet, so the cost of what you sold is not in this statement and the "
                         + "profit shown is before cost of sales.";
                report.Notice = report.Notice is null ? note : report.Notice + " " + note;
            }

            return report;
        }

        // ── General Ledger ────────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetGeneralLedgerAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var singleAccount = filter.AccountId.HasValue;

            var report = await NewReportAsync(companyId, "General Ledger", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("entryRef", "Entry"),
                Col("account", "Account"),
                Col("reference", "Document"),
                Col("description", "Description"),
                Col("party", "Party"),
                Col("debit", "Debit", "money", totalled: true),
                Col("credit", "Credit", "money", totalled: true),
            };
            // A running balance across mixed accounts is a meaningless number, so
            // the column only appears when the report is scoped to one account.
            if (singleAccount) report.Columns.Add(Col("balance", "Balance", "money"));

            if (!glOn)
            {
                report.Notice = "The general ledger is empty because GL posting is off for this "
                              + "company. Enable it in Accounting → Dashboard.";
                return report;
            }

            var q = BuildGeneralLedgerQuery(companyId, filter, window);

            var ordered = q
                .OrderBy(l => l.JournalEntry.Date)
                .ThenBy(l => l.JournalEntryId)
                .ThenBy(l => l.Id);

            report.TotalCount = await ordered.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;
            var offset = (page - 1) * size;

            var opening = 0m;
            if (singleAccount)
            {
                // Same opening figure the account ledger uses: the balance as at the
                // day before the window.
                opening = window.From.HasValue
                    ? (await _gl.GetAccountBalancesAsync(companyId, window.From.Value.AddDays(-1)))
                        .GetValueOrDefault(filter.AccountId!.Value)
                    : await _context.Accounts.AsNoTracking()
                        .Where(a => a.Id == filter.AccountId!.Value && a.CompanyId == companyId)
                        .Select(a => a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance)
                        .FirstOrDefaultAsync();
                opening += offset > 0
                    ? await ordered.Take(offset).SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                    : 0m;
            }

            var rows = await ordered.Skip(offset).Take(size)
                .Select(l => new
                {
                    l.Id, l.JournalEntryId, l.JournalEntry.EntryNo, l.JournalEntry.Date,
                    l.JournalEntry.SourceDocType, l.JournalEntry.SourceDocId, l.JournalEntry.Narration,
                    l.Description, l.Debit, l.Credit, l.AccountId,
                    AccountName = l.Account.Name, l.Account.Code, l.Account.AccountType,
                    l.PartyType, l.PartyId,
                    EntryDivisionId = l.JournalEntry.DivisionId,
                })
                .ToListAsync();

            var refs = await LoadSourceReferencesAsync(companyId,
                rows.Select(r => (r.SourceDocType.ToString(), r.SourceDocId)).ToList());
            var partyNames = await LoadPartyNamesAsync(companyId,
                rows.Select(r => (r.PartyType, r.PartyId)));
            var divisionIds = rows.Where(r => r.EntryDivisionId.HasValue)
                .Select(r => r.EntryDivisionId!.Value).Distinct().ToList();
            var divisionNames = divisionIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Divisions.AsNoTracking()
                    .Where(d => d.CompanyId == companyId && divisionIds.Contains(d.Id))
                    .ToDictionaryAsync(d => d.Id, d => d.Name);

            var running = opening;
            var built = new List<object>(rows.Count);
            foreach (var r in rows)
            {
                running += r.Debit - r.Credit;
                built.Add(new GeneralLedgerRowDto
                {
                    Date = r.Date,
                    JournalEntryId = r.JournalEntryId,
                    EntryNo = r.EntryNo,
                    EntryRef = $"JE-{r.EntryNo}",
                    AccountId = r.AccountId,
                    Account = r.AccountName,
                    Code = r.Code,
                    AccountType = r.AccountType.ToString(),
                    SourceType = r.SourceDocType.ToString(),
                    SourceId = r.SourceDocId,
                    Reference = refs.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId)),
                    Description = FirstNonEmpty(r.Description, r.Narration),
                    Party = r.PartyType != null && r.PartyId.HasValue
                        ? partyNames.GetValueOrDefault((r.PartyType, r.PartyId.Value)) : null,
                    Debit = r.Debit,
                    Credit = r.Credit,
                    Balance = singleAccount ? running : null,
                    Division = r.EntryDivisionId.HasValue
                        ? divisionNames.GetValueOrDefault(r.EntryDivisionId.Value) : null,
                });
            }
            report.Rows = built;

            var totals = await q.GroupBy(_ => 1)
                .Select(g => new { Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .FirstOrDefaultAsync();
            report.Totals["debit"] = totals?.Dr ?? 0m;
            report.Totals["credit"] = totals?.Cr ?? 0m;
            report.Totals["postings"] = report.TotalCount;
            report.TotalLabels["debit"] = "Total Debit";
            report.TotalLabels["credit"] = "Total Credit";
            report.TotalLabels["postings"] = "Postings";

            // Debits must equal credits over any complete set of entries. When a
            // filter cuts across entries (one account, one group) they legitimately
            // will not, so the check is only asserted when nothing narrows it.
            var wholeLedger = !filter.AccountId.HasValue && !filter.AccountGroupId.HasValue
                              && string.IsNullOrWhiteSpace(filter.Search) && !filter.DivisionId.HasValue;
            if (wholeLedger && Math.Abs((totals?.Dr ?? 0m) - (totals?.Cr ?? 0m)) > 0.01m)
                report.Notice = "Debits and credits do not agree over this period, which should be "
                              + "impossible. Check Accounting → Dashboard for ledger health.";

            return report;
        }

        private IQueryable<JournalLine> BuildGeneralLedgerQuery(int companyId,
            ReportFilterDto f, ReportWindow window)
        {
            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId);

            q = ScopeToDivisions(q, f);

            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (f.AccountId.HasValue) q = q.Where(l => l.AccountId == f.AccountId!.Value);
            if (f.AccountGroupId.HasValue)
                q = q.Where(l => l.Account.AccountGroupId == f.AccountGroupId!.Value);
            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value
                              || l.DivisionId == f.DivisionId!.Value);
            if (f.ClientId.HasValue)
                q = q.Where(l => l.PartyType == "Client" && l.PartyId == f.ClientId!.Value);
            if (f.SupplierId.HasValue)
                q = q.Where(l => l.PartyType == "Supplier" && l.PartyId == f.SupplierId!.Value);

            if (!string.IsNullOrWhiteSpace(f.Status))
            {
                switch (f.Status.Trim().ToLowerInvariant())
                {
                    case "journal":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.ManualJournal); break;
                    case "system":
                        q = q.Where(l => l.JournalEntry.SourceDocType != SourceDocType.ManualJournal); break;
                }
            }

            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(l => EF.Functions.Like(l.Account.Name, $"%{s}%")
                              || (l.Description != null && EF.Functions.Like(l.Description, $"%{s}%"))
                              || (l.JournalEntry.Narration != null
                                  && EF.Functions.Like(l.JournalEntry.Narration, $"%{s}%")));
            }

            return q;
        }

        // ── Account Balance Summary ───────────────────────────────────────────────

        public async Task<ReportResultDto> GetAccountBalanceSummaryAsync(int companyId,
            ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Account Balance Summary", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("code", "Code"),
                Col("account", "Account"),
                Col("accountType", "Type"),
                Col("accountGroup", "Group"),
                Col("opening", "Opening", "money", totalled: true),
                Col("debit", "Debit", "money", totalled: true),
                Col("credit", "Credit", "money", totalled: true),
                Col("closing", "Closing", "money", totalled: true),
            };

            // Reuse the trial balance rather than recomputing per-account movement —
            // then the two reports cannot disagree, and the Trial Balance stays the
            // single definition of opening/debit/credit/closing.
            var tb = await _gl.GetTrialBalanceAsync(companyId, window.From, window.To);

            var (groups, accounts) = await LoadChartAsync(companyId);
            var groupNameById = groups.ToDictionary(g => g.Id, g => g.Name);
            var accountMeta = accounts.ToDictionary(a => a.Id,
                a => (a.AccountGroupId, GroupName: groupNameById.GetValueOrDefault(a.AccountGroupId)));

            var rows = tb.Rows.Select(r =>
            {
                accountMeta.TryGetValue(r.AccountId, out var meta);
                return new AccountBalanceRowDto
                {
                    AccountId = r.AccountId,
                    Code = r.Code,
                    Account = r.Name,
                    AccountType = r.AccountType,
                    AccountGroupId = meta.AccountGroupId == 0 ? null : meta.AccountGroupId,
                    AccountGroup = meta.GroupName,
                    Opening = r.Opening,
                    Debit = r.Debit,
                    Credit = r.Credit,
                    Closing = r.Closing,
                };
            }).AsEnumerable();

            if (filter.AccountGroupId.HasValue)
                rows = rows.Where(r => r.AccountGroupId == filter.AccountGroupId.Value);
            if (filter.AccountId.HasValue)
                rows = rows.Where(r => r.AccountId == filter.AccountId.Value);
            if (!string.IsNullOrWhiteSpace(filter.Status))
            {
                // Status doubles as the account-type filter here — the operator's
                // question is "show me only the expense accounts".
                var t = filter.Status.Trim();
                rows = rows.Where(r => r.AccountType.Equals(t, StringComparison.OrdinalIgnoreCase));
            }
            if (!string.IsNullOrWhiteSpace(filter.Search))
            {
                var s = filter.Search.Trim();
                rows = rows.Where(r =>
                    r.Account.Contains(s, StringComparison.OrdinalIgnoreCase)
                    || (r.Code ?? "").Contains(s, StringComparison.OrdinalIgnoreCase)
                    || (r.AccountGroup ?? "").Contains(s, StringComparison.OrdinalIgnoreCase));
            }

            var list = rows.ToList();
            report.Rows = list.Cast<object>().ToList();
            report.TotalCount = list.Count;
            report.Page = 1;
            report.PageSize = list.Count;
            report.Totals["opening"] = list.Sum(r => r.Opening);
            report.Totals["debit"] = list.Sum(r => r.Debit);
            report.Totals["credit"] = list.Sum(r => r.Credit);
            report.Totals["closing"] = list.Sum(r => r.Closing);
            report.Totals["accounts"] = list.Count;
            report.TotalLabels["debit"] = "Total Debit";
            report.TotalLabels["credit"] = "Total Credit";
            report.TotalLabels["accounts"] = "Accounts";

            if (!glOn)
                report.Notice = "GL posting is off for this company, so these figures are the "
                              + "chart-of-accounts opening balances with no movement.";
            return report;
        }

        // ── Trial Balance (in the report envelope) ────────────────────────────────

        public async Task<ReportResultDto> GetTrialBalanceReportAsync(int companyId,
            ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Trial Balance", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("code", "Code"),
                Col("name", "Account"),
                Col("accountType", "Type"),
                Col("opening", "Opening", "money", totalled: true),
                Col("debit", "Debit", "money", totalled: true),
                Col("credit", "Credit", "money", totalled: true),
                Col("closing", "Closing", "money", totalled: true),
            };

            // The same primitive the existing Trial Balance screen uses. This wrapper
            // exists only to give it the shared header, print, PDF and Excel.
            var tb = await _gl.GetTrialBalanceAsync(companyId, window.From, window.To);
            report.Rows = tb.Rows.Cast<object>().ToList();
            report.TotalCount = tb.Rows.Count;
            report.Page = 1;
            report.PageSize = tb.Rows.Count;
            report.Totals["opening"] = tb.TotalOpening;
            report.Totals["debit"] = tb.TotalDebit;
            report.Totals["credit"] = tb.TotalCredit;
            report.Totals["closing"] = tb.TotalClosing;
            report.TotalLabels["debit"] = "Total Debit";
            report.TotalLabels["credit"] = "Total Credit";

            var diff = tb.TotalDebit - tb.TotalCredit;
            if (Math.Abs(diff) > 0.01m)
                report.Notice = $"Debits and credits differ by {Math.Abs(diff):N2}. The ledger should "
                              + "always balance — check Accounting → Dashboard for ledger health and "
                              + "the Suspense account for unresolved postings.";
            return report;
        }

        // ── Shared statement plumbing ─────────────────────────────────────────────

        private async Task<StatementResultDto> NewStatementAsync(int companyId, string title,
            ReportWindow window, ReportFilterDto filter, bool glOn, string statement,
            DateTime? asOf, string? comparativeLabel)
        {
            var envelope = await NewReportAsync(companyId, title, window, filter, glOn);
            return new StatementResultDto
            {
                Title = envelope.Title,
                CompanyName = envelope.CompanyName,
                PeriodLabel = envelope.PeriodLabel,
                From = envelope.From,
                To = envelope.To,
                FiltersApplied = envelope.FiltersApplied,
                GeneratedAt = envelope.GeneratedAt,
                LedgerSourced = glOn,
                Statement = statement,
                AsOf = asOf,
                ComparativeLabel = comparativeLabel,
                Columns = comparativeLabel == null
                    ? StatementColumns
                    : StatementColumnsWithComparative(comparativeLabel),
            };
        }

        private static void FinishStatement(StatementResultDto report,
            List<StatementLineDto> lines, bool comparative, DateTime? priorDate)
        {
            // Percentages only where they mean something: a change from zero is not
            // "infinite growth", it is a new figure.
            foreach (var l in lines)
            {
                if (l.Comparative is null || l.Change is null) continue;
                if (l.Comparative.Value == 0m) continue;
                l.ChangePercent = Math.Round(l.Change.Value / Math.Abs(l.Comparative.Value) * 100m, 1);
            }
            report.Rows = lines.Cast<object>().ToList();
            report.TotalCount = lines.Count;
            report.Page = 1;
            report.PageSize = lines.Count;
        }

        private async Task<(List<AccountGroup> Groups, List<Account> Accounts)> LoadChartAsync(int companyId)
        {
            var groups = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId)
                .OrderBy(g => g.Position).ThenBy(g => g.Id)
                .ToListAsync();
            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId)
                .OrderBy(a => a.Position).ThenBy(a => a.Id)
                .ToListAsync();
            return (groups, accounts);
        }

        private static List<AccountGroup> RootsOf(List<AccountGroup> groups, FinancialStatement statement) =>
            groups.Where(g => g.ParentGroupId == null && g.Statement == statement)
                .OrderBy(g => g.Position).ThenBy(g => g.Id).ToList();

        /// <summary>
        /// Whether a balance-sheet section is debit-natural (assets). Decided by the
        /// account types actually inside it rather than the group's name, so a
        /// renamed or translated group still lands on the right side.
        /// </summary>
        private static bool IsAssetSection(AccountGroup root, List<Account> accounts)
        {
            var inSection = accounts.Where(a => a.AccountGroupId == root.Id).ToList();
            if (inSection.Count > 0)
                return inSection.Count(a => a.AccountType == AccountType.Asset) * 2 >= inSection.Count;
            // An empty top group falls back to its name — better than guessing wrong.
            return root.Name.Contains("asset", StringComparison.OrdinalIgnoreCase);
        }

        private static bool SectionIsIncome(AccountGroup root, List<Account> accounts)
        {
            var inSection = accounts.Where(a => a.AccountGroupId == root.Id).ToList();
            if (inSection.Count > 0)
                return inSection.Count(a => a.AccountType == AccountType.Income) * 2 >= inSection.Count;
            return root.Name.Contains("income", StringComparison.OrdinalIgnoreCase)
                || root.Name.Contains("revenue", StringComparison.OrdinalIgnoreCase)
                || root.Name.Contains("sales", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>Cost-of-sales is a naming convention (the seeder creates
        /// "Cost of Sales"); there is no flag for it on the group.</summary>
        private static bool IsCostOfSalesSection(AccountGroup root)
        {
            var n = root.Name.ToLowerInvariant();
            return n.Contains("cost of sale") || n.Contains("cost of good") || n == "cogs"
                || n.Contains("direct cost");
        }

        private sealed record StatementSection(
            List<StatementLineDto> Lines, decimal Total, decimal? Comparative);

        /// <summary>
        /// Flatten one statement section — its own accounts, then its child groups
        /// recursively — into indented lines, returning the section subtotal.
        /// Zero-value lines are dropped: a statement listing forty accounts at 0.00
        /// buries the ten that matter.
        /// </summary>
        private static StatementSection BuildStatementSection(AccountGroup group,
            List<AccountGroup> groups, List<Account> accounts,
            Dictionary<int, decimal> now, Dictionary<int, decimal>? then,
            decimal sign, int level)
        {
            var lines = new List<StatementLineDto> {
                new() { Level = level, Kind = "group", Label = group.Name },
            };
            var total = 0m;
            var pTotal = 0m;

            foreach (var a in accounts.Where(x => x.AccountGroupId == group.Id))
            {
                var amount = now.GetValueOrDefault(a.Id) * sign;
                var pAmount = then?.GetValueOrDefault(a.Id) * sign;
                total += amount;
                pTotal += pAmount ?? 0m;
                if (amount == 0m && (pAmount ?? 0m) == 0m) continue;

                lines.Add(new StatementLineDto
                {
                    Level = level + 1, Kind = "account", Label = a.Name,
                    AccountId = a.Id, Code = a.Code,
                    Amount = amount,
                    Comparative = pAmount,
                    Change = pAmount is null ? null : amount - pAmount,
                });
            }

            foreach (var child in groups
                .Where(g => g.ParentGroupId == group.Id)
                .OrderBy(g => g.Position).ThenBy(g => g.Id))
            {
                var sub = BuildStatementSection(child, groups, accounts, now, then, sign, level + 1);
                total += sub.Total;
                pTotal += sub.Comparative ?? 0m;
                if (sub.Total == 0m && (sub.Comparative ?? 0m) == 0m) continue;
                lines.AddRange(sub.Lines);
                lines.Add(Subtotal($"Total {child.Name}", level + 1, sub.Total, sub.Comparative));
            }

            // A section with nothing in it is noise on a statement.
            if (total == 0m && pTotal == 0m && lines.Count == 1)
                return new StatementSection(new List<StatementLineDto>(), 0m, then == null ? null : 0m);

            return new StatementSection(lines, total, then == null ? null : pTotal);
        }

        /// <summary>Net movement/position of a whole statement side, for the
        /// Current-Year Earnings line.</summary>
        private static decimal NetOfStatement(List<AccountGroup> groups, List<Account> accounts,
            Dictionary<int, decimal> balances, FinancialStatement statement)
        {
            var groupIds = groups.Where(g => g.Statement == statement).Select(g => g.Id).ToHashSet();
            return accounts.Where(a => groupIds.Contains(a.AccountGroupId))
                .Sum(a => balances.GetValueOrDefault(a.Id));
        }

        /// <summary>Per-account movement inside a window — the flow a P&amp;L needs,
        /// as opposed to the position a balance sheet needs.</summary>
        private async Task<Dictionary<int, decimal>> MovementByAccountAsync(int companyId,
            ReportFilterDto f, DateTime? from, DateTime? to)
        {
            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId);
            q = ScopeToDivisions(q, f);
            if (from.HasValue) q = q.Where(l => l.JournalEntry.Date >= from.Value);
            if (to.HasValue) q = q.Where(l => l.JournalEntry.Date <= to.Value);
            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value
                              || l.DivisionId == f.DivisionId!.Value);

            return (await q.GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                .ToListAsync()).ToDictionary(x => x.AccountId, x => x.Net);
        }

        private static StatementLineDto Subtotal(string label, int level, decimal amount, decimal? comparative) =>
            new()
            {
                Level = level, Kind = "subtotal", Label = label, Amount = amount,
                Comparative = comparative,
                Change = comparative is null ? null : amount - comparative,
            };

        private static StatementLineDto Total(string label, decimal amount, decimal? comparative) =>
            new()
            {
                Level = 0, Kind = "total", Label = label, Amount = amount,
                Comparative = comparative,
                Change = comparative is null ? null : amount - comparative,
            };
    }
}
