using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Tax reports and the accounting control checks.
    ///
    /// ── Tax comes from the tax accounts, not the documents ──
    /// It would be easy to sum <c>Invoice.GSTAmount</c> and call it output tax. That
    /// misses input tax on expenses (a payment allocated to an expense account with
    /// a tax slice), and it misses any adjustment an accountant journalled. Every one
    /// of those DOES hit the Output Tax or Input Tax control account, so the reports
    /// read those accounts — which also means the tax reports and the Balance Sheet
    /// always agree about what is owed to the revenue authority.
    ///
    /// Output tax is credit-natural (a liability): charging a customer credits it,
    /// so credits minus debits is what was charged. Input tax is debit-natural (a
    /// receivable): paying a supplier debits it. Both are presented positive.
    ///
    /// ── No tax rules are invented ──
    /// Nothing here decides what is taxable, at what rate, or what may be reclaimed.
    /// The reports show what was recorded and what the ledger says is owed. Rate
    /// grouping uses the rate that was actually applied to the document, not a rate
    /// table.
    ///
    /// ── Control reports ──
    /// This product has no draft/posted state — documents post immediately and
    /// <c>PostingService</c> asserts balance or throws. So instead of "unposted
    /// transactions" the useful checks are: what landed in Suspense (a role account
    /// was missing), which documents have no journal entry at all, and whether any
    /// entry is unbalanced. The last should always be empty; it is cheap insurance.
    /// </summary>
    public partial class AccountingReportService
    {
        // ── Tax summary ───────────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetTaxSummaryAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Tax Summary", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", "Tax account"),
                Col("kind", "Type"),
                Col("amount", "Amount", "money", totalled: true),
                Col("count", "Transactions", "int"),
            };

            if (!glOn)
            {
                report.Notice = "Tax figures come from the Output Tax and Input Tax accounts in the "
                              + "general ledger, which is off for this company. Enable GL posting in "
                              + "Accounting → Dashboard.";
                return report;
            }

            // Each row keeps its own kind, rather than being re-derived from the
            // list afterwards.
            var detail = new List<(string Label, string Kind, decimal Amount, int Count, int AccountId)>();
            // Sales tax and withholding tax are kept apart on purpose. Both are owed
            // to or reclaimable from the same revenue authority, but they are
            // DIFFERENT taxes: output/input are sales tax on the goods, while
            // withholding is income tax deducted at source. Netting all four into one
            // figure produces a number that is not the sales-tax position and not the
            // withholding position either, and an operator filing a sales-tax return
            // would read it as the former.
            decimal output = 0, input = 0, whtPayable = 0, whtReceivable = 0;

            foreach (var (control, kind) in new[]
            {
                (ControlType.OutputTax, "Sales tax charged to customers"),
                (ControlType.InputTax, "Sales tax paid to suppliers"),
                (ControlType.WithholdingPayable, "Income tax withheld from suppliers"),
                (ControlType.WithholdingReceivable, "Income tax withheld by customers"),
            })
            {
                var isPayable = control is ControlType.OutputTax or ControlType.WithholdingPayable;
                var accounts = await TaxAccountsAsync(companyId, control);
                foreach (var a in accounts)
                {
                    var q = TaxLinesQuery(companyId, filter, window, a.Id);
                    var agg = await q.GroupBy(_ => 1)
                        .Select(g => new
                        {
                            Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit),
                            Count = g.Select(x => x.JournalEntryId).Distinct().Count(),
                        })
                        .FirstOrDefaultAsync();
                    if (agg == null) continue;

                    // Payable accounts are credit-natural, receivable ones debit-natural.
                    var amount = isPayable ? agg.Cr - agg.Dr : agg.Dr - agg.Cr;
                    if (amount == 0m && agg.Count == 0) continue;

                    detail.Add((a.Name, kind, amount, agg.Count, a.Id));
                    switch (control)
                    {
                        case ControlType.OutputTax: output += amount; break;
                        case ControlType.InputTax: input += amount; break;
                        case ControlType.WithholdingPayable: whtPayable += amount; break;
                        default: whtReceivable += amount; break;
                    }
                }
            }

            // Rows carry a Type so a reader can tell a payable from a receivable
            // without having to know the account names.
            report.Rows = detail.Select(r => (object)new
            {
                label = r.Label,
                kind = r.Kind,
                amount = r.Amount,
                count = r.Count,
                accountId = r.AccountId,
            }).ToList();
            report.TotalCount = detail.Count;
            report.Page = 1;
            report.PageSize = detail.Count;

            report.Totals["outputTax"] = output;
            report.Totals["inputTax"] = input;
            report.Totals["netSalesTax"] = output - input;
            report.TotalLabels["outputTax"] = "Output Sales Tax";
            report.TotalLabels["inputTax"] = "Input Sales Tax";
            report.TotalLabels["netSalesTax"] = output - input >= 0
                ? "Net Sales Tax Payable" : "Net Sales Tax Refundable";

            // Withholding only appears when there is any, so a company that does not
            // deal with it is not shown two zeroes it has to interpret.
            if (whtPayable != 0m || whtReceivable != 0m)
            {
                report.Totals["withholdingPayable"] = whtPayable;
                report.Totals["withholdingReceivable"] = whtReceivable;
                report.TotalLabels["withholdingPayable"] = "Income Tax Withheld (owed)";
                report.TotalLabels["withholdingReceivable"] = "Income Tax Withheld From Us";
                report.Notice = "Sales tax and withholding tax are shown separately because they are "
                              + "different taxes: the sales-tax position is what a sales-tax return "
                              + "reports, while withholding is income tax deducted at source. They are "
                              + "deliberately not netted into a single figure.";
            }

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = "Tax accounts",
                DrillFilter = "accountId",
                Rows = detail.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.AccountId.ToString(),
                    Label = r.Label,
                    Amount = r.Amount,
                    Count = r.Count,
                }).ToList(),
                Total = detail.Sum(r => r.Amount),
            });

            return report;
        }

        // ── Output / input tax detail ─────────────────────────────────────────────

        /// <summary>
        /// Every posting to the tax accounts, with the document and party behind it.
        /// <paramref name="output"/> true = tax charged to customers; false = tax paid
        /// to suppliers and on expenses. Null = both, which is the Tax Transaction
        /// Detail report.
        /// </summary>
        public async Task<ReportResultDto> GetTaxDetailAsync(int companyId,
            ReportFilterDto filter, bool? output)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var title = output switch
            {
                true => "Sales Tax (Output Tax)",
                false => "Purchase Tax (Input Tax)",
                null => "Tax Transaction Detail",
            };
            var report = await NewReportAsync(companyId, title, window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("reference", "Document"),
                Col("transaction", "Type"),
                Col("party", "Party"),
                Col("taxAccount", "Tax account"),
                Col("taxableAmount", "Taxable", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
            };

            if (!glOn)
            {
                report.Notice = "Tax detail comes from the general ledger, which is off for this "
                              + "company. Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var controls = output switch
            {
                true => new[] { ControlType.OutputTax },
                false => new[] { ControlType.InputTax },
                null => new[] { ControlType.OutputTax, ControlType.InputTax },
            };

            var accountIds = new List<int>();
            var accountNames = new Dictionary<int, string>();
            var payableAccounts = new HashSet<int>();
            foreach (var c in controls)
            {
                foreach (var a in await TaxAccountsAsync(companyId, c))
                {
                    accountIds.Add(a.Id);
                    accountNames[a.Id] = a.Name;
                    if (c == ControlType.OutputTax) payableAccounts.Add(a.Id);
                }
            }
            if (accountIds.Count == 0)
            {
                report.Notice = "This company has no tax accounts set up, so there is nothing to "
                              + "report. Add an Output Tax and an Input Tax account in the Chart of "
                              + "Accounts.";
                return report;
            }

            var q = TaxLinesQuery(companyId, filter, window, accountIds);

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                .OrderByDescending(l => l.JournalEntry.Date)
                .ThenByDescending(l => l.JournalEntryId)
                .Skip((page - 1) * size).Take(size)
                .Select(l => new
                {
                    l.JournalEntry.Date, l.JournalEntryId, l.JournalEntry.EntryNo,
                    l.JournalEntry.SourceDocType, l.JournalEntry.SourceDocId,
                    l.AccountId, l.Debit, l.Credit, l.PartyType, l.PartyId, l.Description,
                })
                .ToListAsync();

            var refs = await LoadSourceReferencesAsync(companyId,
                rows.Select(r => (r.SourceDocType.ToString(), r.SourceDocId)).ToList());
            var partyNames = await LoadPartyNamesAsync(companyId,
                rows.Select(r => (r.PartyType, r.PartyId)));

            // The taxable amount is the document's own subtotal share, so it comes
            // from the source document rather than being reverse-engineered from the
            // tax figure and a rate.
            var invoiceIds = rows.Where(r => r.SourceDocType == SourceDocType.Invoice
                                          && r.SourceDocId.HasValue)
                .Select(r => r.SourceDocId!.Value).Distinct().ToList();
            var billIds = rows.Where(r => r.SourceDocType == SourceDocType.PurchaseBill
                                       && r.SourceDocId.HasValue)
                .Select(r => r.SourceDocId!.Value).Distinct().ToList();
            var taxable = new Dictionary<(string, int), decimal>();
            if (invoiceIds.Count > 0)
                foreach (var x in await _context.Invoices.AsNoTracking()
                             .Where(i => invoiceIds.Contains(i.Id))
                             .Select(i => new { i.Id, i.Subtotal }).ToListAsync())
                    taxable[("Invoice", x.Id)] = x.Subtotal;
            if (billIds.Count > 0)
                foreach (var x in await _context.PurchaseBills.AsNoTracking()
                             .Where(b => billIds.Contains(b.Id))
                             .Select(b => new { b.Id, b.Subtotal }).ToListAsync())
                    taxable[("PurchaseBill", x.Id)] = x.Subtotal;

            report.Rows = rows.Select(r =>
            {
                var isPayable = payableAccounts.Contains(r.AccountId);
                var tax = isPayable ? r.Credit - r.Debit : r.Debit - r.Credit;
                return (object)new
                {
                    date = r.Date,
                    reference = refs.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId))
                                ?? $"JE-{r.EntryNo}",
                    transaction = isPayable ? "Output tax" : "Input tax",
                    party = r.PartyType != null && r.PartyId.HasValue
                        ? partyNames.GetValueOrDefault((r.PartyType, r.PartyId.Value)) : null,
                    taxAccount = accountNames.GetValueOrDefault(r.AccountId),
                    taxableAmount = r.SourceDocId.HasValue
                        ? taxable.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId.Value))
                        : 0m,
                    tax,
                    sourceType = r.SourceDocType.ToString(),
                    sourceId = r.SourceDocId,
                    journalEntryId = r.JournalEntryId,
                };
            }).ToList();

            var totals = await q.GroupBy(_ => 1)
                .Select(g => new { Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .FirstOrDefaultAsync();
            // For a single-direction report the net is unambiguous; for both, output
            // and input are reported separately so they are not silently netted.
            if (output == true) report.Totals["tax"] = (totals?.Cr ?? 0m) - (totals?.Dr ?? 0m);
            else if (output == false) report.Totals["tax"] = (totals?.Dr ?? 0m) - (totals?.Cr ?? 0m);
            else
            {
                report.Totals["outputTax"] = totals?.Cr ?? 0m;
                report.Totals["inputTax"] = totals?.Dr ?? 0m;
                report.Totals["netTax"] = (totals?.Cr ?? 0m) - (totals?.Dr ?? 0m);
                report.TotalLabels["outputTax"] = "Output Tax";
                report.TotalLabels["inputTax"] = "Input Tax";
                report.TotalLabels["netTax"] = "Net";
            }
            report.Totals["transactionCount"] = report.TotalCount;
            report.TotalLabels["tax"] = output == true ? "Tax Charged" : "Tax Paid";
            report.TotalLabels["transactionCount"] = "Postings";

            if (report.TotalCount == 0)
                report.Notice = "No tax postings in this period. Either nothing was taxed, or the "
                              + "documents were entered without tax.";
            return report;
        }

        /// <summary>Tax grouped by the customer it was charged to, or the supplier it
        /// was paid to. Only lines carrying a party can appear; expense input tax with
        /// no supplier is grouped as unattributed rather than dropped.</summary>
        public async Task<ReportResultDto> GetTaxByPartyAsync(int companyId,
            ReportFilterDto filter, bool customers)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId,
                customers ? "Tax by Customer" : "Tax by Supplier", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", customers ? "Customer" : "Supplier"),
                Col("amount", customers ? "Output tax charged" : "Input tax paid", "money", totalled: true),
                Col("count", "Transactions", "int"),
            };

            if (!glOn)
            {
                report.Notice = "Tax figures come from the general ledger, which is off for this "
                              + "company.";
                return report;
            }

            var control = customers ? ControlType.OutputTax : ControlType.InputTax;
            var accounts = await TaxAccountsAsync(companyId, control);
            if (accounts.Count == 0)
            {
                report.Notice = $"This company has no {(customers ? "Output" : "Input")} Tax account "
                              + "set up, so there is nothing to report.";
                return report;
            }

            var accountIds = accounts.Select(a => a.Id).ToList();
            var partyType = customers ? "Client" : "Supplier";
            var q = TaxLinesQuery(companyId, filter, window, accountIds);

            var tagged = await q.Where(l => l.PartyType == partyType && l.PartyId != null)
                .GroupBy(l => l.PartyId!.Value)
                .Select(g => new
                {
                    PartyId = g.Key,
                    Amount = g.Sum(x => customers ? x.Credit - x.Debit : x.Debit - x.Credit),
                    Count = g.Select(x => x.JournalEntryId).Distinct().Count(),
                })
                .ToListAsync();

            var untaggedTotal = await q.Where(l => l.PartyId == null)
                .SumAsync(l => (decimal?)(customers ? l.Credit - l.Debit : l.Debit - l.Credit)) ?? 0m;
            var untaggedCount = await q.Where(l => l.PartyId == null)
                .Select(l => l.JournalEntryId).Distinct().CountAsync();

            var names = await LoadPartyNamesAsync(companyId,
                tagged.Select(t => ((string?)partyType, (int?)t.PartyId)));

            var rows = tagged.Select(t => new ReportGroupRowDto
            {
                DrillKey = t.PartyId.ToString(),
                Label = names.GetValueOrDefault((partyType, t.PartyId)) ?? $"{partyType} #{t.PartyId}",
                Amount = t.Amount,
                Count = t.Count,
            }).OrderByDescending(r => r.Amount).ToList();

            if (Math.Abs(untaggedTotal) > 0.005m)
                rows.Add(new ReportGroupRowDto
                {
                    DrillKey = null,
                    // Named for what it is: input tax on an expense often has no
                    // supplier, and a journal adjustment never does.
                    Label = "Not attributed to a party (expenses / journals)",
                    Amount = untaggedTotal,
                    Count = untaggedCount,
                });

            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["amount"] = rows.Sum(r => r.Amount);
            report.Totals["transactionCount"] = rows.Sum(r => r.Count);
            report.TotalLabels["amount"] = customers ? "Total Output Tax" : "Total Input Tax";

            // An empty report has to say WHY it is empty. The tax account exists, so
            // the reason is that nothing in this period carried tax — which is a
            // useful answer, not a blank screen for the operator to interpret.
            if (rows.Count == 0)
                report.Notice = $"No {(customers ? "output" : "input")} tax was recorded in this "
                              + "period. Either nothing was taxed, or tax is not being applied on "
                              + $"the {(customers ? "invoices" : "bills and expenses")}.";
            report.TotalLabels["transactionCount"] = "Transactions";
            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = customers ? "Tax by Customer" : "Tax by Supplier",
                DrillFilter = customers ? "clientId" : "supplierId",
                Rows = rows,
                Total = rows.Sum(r => r.Amount),
            });
            return report;
        }

        private async Task<List<Account>> TaxAccountsAsync(int companyId, ControlType control) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == control)
                .OrderBy(a => a.Name)
                .ToListAsync();

        private IQueryable<JournalLine> TaxLinesQuery(int companyId, ReportFilterDto f,
            ReportWindow window, int accountId) =>
            TaxLinesQuery(companyId, f, window, new List<int> { accountId });

        private IQueryable<JournalLine> TaxLinesQuery(int companyId, ReportFilterDto f,
            ReportWindow window, List<int> accountIds)
        {
            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && accountIds.Contains(l.AccountId));
            q = ScopeToDivisions(q, f);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value
                              || l.DivisionId == f.DivisionId!.Value);
            if (f.ClientId.HasValue)
                q = q.Where(l => l.PartyType == "Client" && l.PartyId == f.ClientId!.Value);
            if (f.SupplierId.HasValue)
                q = q.Where(l => l.PartyType == "Supplier" && l.PartyId == f.SupplierId!.Value);
            if (f.AccountId.HasValue) q = q.Where(l => l.AccountId == f.AccountId!.Value);
            if (!string.IsNullOrWhiteSpace(f.Status))
            {
                switch (f.Status.Trim().ToLowerInvariant())
                {
                    case "invoice":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Invoice); break;
                    case "bill":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.PurchaseBill); break;
                    case "payment":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Payment); break;
                    case "journal":
                        q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.ManualJournal); break;
                }
            }
            return q;
        }

        // ── Journal register ──────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetJournalRegisterAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Journal Register", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("entryRef", "Entry"),
                Col("source", "Source"),
                Col("reference", "Document"),
                Col("narration", "Narration"),
                Col("lines", "Lines", "int"),
                Col("amount", "Amount", "money", totalled: true),
                Col("balanced", "Balanced", "status"),
            };

            if (!glOn)
            {
                report.Notice = "The journal is empty because GL posting is off for this company.";
                return report;
            }

            var q = _context.JournalEntries.AsNoTracking()
                .Where(e => e.CompanyId == companyId);
            if (window.From.HasValue) q = q.Where(e => e.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(e => e.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue) q = q.Where(e => e.DivisionId == filter.DivisionId!.Value);
            if (filter.AllowedDivisionIds != null)
            {
                var allowed = filter.AllowedDivisionIds;
                q = q.Where(e => e.DivisionId == null || allowed.Contains(e.DivisionId.Value));
            }
            if (!string.IsNullOrWhiteSpace(filter.Status))
            {
                var s = filter.Status.Trim().ToLowerInvariant();
                if (s == "journal")
                    q = q.Where(e => e.SourceDocType == SourceDocType.ManualJournal);
                else if (s == "system")
                    q = q.Where(e => e.SourceDocType != SourceDocType.ManualJournal);
                else if (s == "unbalanced")
                    q = q.Where(e => e.Lines.Sum(l => l.Debit) != e.Lines.Sum(l => l.Credit));
            }
            if (!string.IsNullOrWhiteSpace(filter.Search))
            {
                var s = filter.Search.Trim();
                q = q.Where(e => e.Narration != null && EF.Functions.Like(e.Narration, $"%{s}%"));
            }

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                .OrderByDescending(e => e.Date).ThenByDescending(e => e.EntryNo)
                .Skip((page - 1) * size).Take(size)
                .Select(e => new
                {
                    e.Id, e.EntryNo, e.Date, e.Narration, e.SourceDocType, e.SourceDocId,
                    Lines = e.Lines.Count,
                    Debit = e.Lines.Sum(l => l.Debit),
                    Credit = e.Lines.Sum(l => l.Credit),
                })
                .ToListAsync();

            var refs = await LoadSourceReferencesAsync(companyId,
                rows.Select(r => (r.SourceDocType.ToString(), r.SourceDocId)).ToList());

            report.Rows = rows.Select(r => (object)new
            {
                date = r.Date,
                entryRef = $"JE-{r.EntryNo}",
                source = r.SourceDocType == SourceDocType.ManualJournal
                    ? "Manual journal" : SourceLabel(r.SourceDocType),
                reference = refs.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId)),
                narration = r.Narration,
                lines = r.Lines,
                // One side, because a balanced entry has equal sides; showing both
                // would just be the same number twice.
                amount = r.Debit,
                balanced = Math.Abs(r.Debit - r.Credit) < 0.005m ? "Balanced" : "UNBALANCED",
                journalEntryId = r.Id,
                sourceType = r.SourceDocType.ToString(),
                sourceId = r.SourceDocId,
            }).ToList();

            var agg = await q.Select(e => new
            {
                Debit = e.Lines.Sum(l => l.Debit), Credit = e.Lines.Sum(l => l.Credit),
            }).ToListAsync();
            report.Totals["amount"] = agg.Sum(x => x.Debit);
            report.Totals["entries"] = report.TotalCount;
            report.Totals["unbalanced"] = agg.Count(x => Math.Abs(x.Debit - x.Credit) >= 0.005m);
            report.TotalLabels["amount"] = "Total Posted";
            report.TotalLabels["entries"] = "Entries";
            report.TotalLabels["unbalanced"] = "Unbalanced";

            if (report.Totals["unbalanced"] > 0)
                report.Notice = $"{report.Totals["unbalanced"]:N0} entries are unbalanced. The posting "
                              + "engine asserts balance before writing, so this should be impossible — "
                              + "filter Status to \"Unbalanced only\" to see them.";
            return report;
        }

        private static string SourceLabel(SourceDocType t) => t switch
        {
            SourceDocType.Invoice => "Sales invoice / note",
            SourceDocType.PurchaseBill => "Purchase bill",
            SourceDocType.Payment => "Receipt / payment",
            SourceDocType.AccountTransfer => "Transfer",
            SourceDocType.PurchaseDebitNote => "Supplier debit note",
            _ => t.ToString(),
        };

        // ── Posting exceptions ────────────────────────────────────────────────────

        /// <summary>
        /// The control report that replaces "unposted transactions", which this
        /// product has no concept of. Three things can actually go wrong:
        ///   1. a posting landed in Suspense because a role account was missing;
        ///   2. a document has no journal entry at all;
        ///   3. an entry is unbalanced (should be impossible).
        /// Each is listed with what to do about it.
        /// </summary>
        public async Task<ReportResultDto> GetPostingExceptionsAsync(int companyId,
            ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Posting Exceptions", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("issue", "Issue"),
                Col("detail", "Detail"),
                Col("count", "Count", "int"),
                Col("amount", "Amount", "money"),
                Col("action", "What to do"),
            };

            var rows = new List<object>();
            var problems = 0;

            if (!glOn)
            {
                rows.Add(new
                {
                    issue = "GL posting is off",
                    detail = "No document in this company writes to the general ledger.",
                    count = 0, amount = 0m,
                    action = "Turn it on from Accounting → Dashboard, which also backfills history.",
                });
                report.Rows = rows;
                report.TotalCount = rows.Count;
                report.Page = 1; report.PageSize = rows.Count;
                report.Totals["problems"] = 1;
                report.TotalLabels["problems"] = "Issues";
                return report;
            }

            // 1. Suspense — the posting engine's visible failure mode.
            var suspense = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == ControlType.Suspense)
                .Select(a => new { a.Id, a.Name }).FirstOrDefaultAsync();
            if (suspense != null)
            {
                var q = _context.JournalLines.AsNoTracking()
                    .Where(l => l.AccountId == suspense.Id && l.JournalEntry.CompanyId == companyId);
                if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
                if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);
                var agg = await q.GroupBy(_ => 1)
                    .Select(g => new { Net = g.Sum(x => x.Debit - x.Credit), Count = g.Count() })
                    .FirstOrDefaultAsync();
                if (agg != null && agg.Count > 0)
                {
                    problems++;
                    rows.Add(new
                    {
                        issue = "Postings in Suspense",
                        detail = $"{agg.Count:N0} lines could not be matched to a role account and "
                               + $"were posted to {suspense.Name} instead.",
                        count = agg.Count,
                        amount = agg.Net,
                        action = "Open the Suspense ledger, find what role account is missing "
                               + "(output tax, a bank account, a sales account) and create it, then "
                               + "rebuild the ledger from Accounting → Dashboard.",
                    });
                }
            }

            // 2. Documents with no journal entry.
            var lockDate = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.GlLockDate).FirstOrDefaultAsync();

            var unpostedInvoices = await _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.GrandTotal != 0
                         && (lockDate == null || i.Date > lockDate)
                         && (window.From == null || i.Date >= window.From)
                         && (window.To == null || i.Date <= window.To)
                         && !_context.JournalEntries.Any(e => e.CompanyId == companyId
                                && e.SourceDocType == SourceDocType.Invoice && e.SourceDocId == i.Id))
                .Select(i => new { i.Id, i.GrandTotal }).ToListAsync();

            var unpostedBills = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && b.GrandTotal != 0
                         && (lockDate == null || b.Date > lockDate)
                         && (window.From == null || b.Date >= window.From)
                         && (window.To == null || b.Date <= window.To)
                         && !_context.JournalEntries.Any(e => e.CompanyId == companyId
                                && e.SourceDocType == SourceDocType.PurchaseBill && e.SourceDocId == b.Id))
                .Select(b => new { b.Id, b.GrandTotal }).ToListAsync();

            if (unpostedInvoices.Count > 0 || unpostedBills.Count > 0)
            {
                problems++;
                rows.Add(new
                {
                    issue = "Documents with no ledger entry",
                    detail = $"{unpostedInvoices.Count:N0} invoices and {unpostedBills.Count:N0} bills "
                           + "have no journal entry, so they are missing from the statements.",
                    count = unpostedInvoices.Count + unpostedBills.Count,
                    amount = unpostedInvoices.Sum(x => x.GrandTotal) + unpostedBills.Sum(x => x.GrandTotal),
                    action = "Rebuild the ledger from Accounting → Dashboard. Documents dated on or "
                           + "before the migration cut-over date are excluded, since their history is "
                           + "carried by frozen entries.",
                });
            }

            // 3. Unbalanced entries.
            var unbalanced = await _context.JournalEntries.AsNoTracking()
                .Where(e => e.CompanyId == companyId
                         && (window.From == null || e.Date >= window.From)
                         && (window.To == null || e.Date <= window.To)
                         && e.Lines.Sum(l => l.Debit) != e.Lines.Sum(l => l.Credit))
                .Select(e => new { e.Id, Dr = e.Lines.Sum(l => l.Debit), Cr = e.Lines.Sum(l => l.Credit) })
                .ToListAsync();
            if (unbalanced.Count > 0)
            {
                problems++;
                rows.Add(new
                {
                    issue = "Unbalanced journal entries",
                    detail = $"{unbalanced.Count:N0} entries where debits do not equal credits.",
                    count = unbalanced.Count,
                    amount = unbalanced.Sum(x => x.Dr - x.Cr),
                    action = "This should be impossible — the posting engine asserts balance before "
                           + "writing. Report it, and check the Journal Register filtered to "
                           + "\"Unbalanced only\".",
                });
            }

            if (problems == 0)
            {
                rows.Add(new
                {
                    issue = "No exceptions",
                    detail = "Nothing in Suspense, every document has a ledger entry, and every "
                           + "entry balances.",
                    count = 0, amount = 0m,
                    action = "Nothing to do.",
                });
            }

            report.Rows = rows;
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["problems"] = problems;
            report.TotalLabels["problems"] = "Issues Found";
            if (problems > 0)
                report.Notice = "These are the things that make the statements wrong. Each row says "
                              + "what to do about it.";
            return report;
        }
    }
}
