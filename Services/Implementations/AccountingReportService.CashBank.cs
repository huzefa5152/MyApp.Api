using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Cash &amp; bank reports — "how much money do we have, and what moved it".
    ///
    /// ── The one rule this file obeys ──
    /// A cash book is an account ledger. It is NOT a second calculation of one.
    /// Opening balances come from <see cref="IGeneralLedgerService.GetAccountBalancesAsync"/>
    /// asked for the day before the window, which is precisely
    /// <c>GetAccountLedgerAsync</c>'s "signed CoA opening + all movement before the
    /// window" — the same figure, from the same code. The only arithmetic here is the
    /// running sum down the page, which is presentation.
    ///
    /// The single-account case delegates outright to <c>GetAccountLedgerAsync</c>, so
    /// a Cash Book of one account and that account's ledger can never disagree.
    ///
    /// ── Presentation ──
    /// Bank and cash accounts are Assets, so debit-positive: money in is a debit and
    /// money out is a credit. The book relabels them Receipt / Payment because that
    /// is what a cashier reads, but the figures are untouched.
    /// </summary>
    public partial class AccountingReportService
    {
        private static readonly List<ReportColumnDto> CashBookColumns = new()
        {
            Col("date", "Date", "date"),
            Col("reference", "Reference"),
            Col("description", "Description"),
            Col("contra", "Account"),
            Col("receipt", "Receipt", "money", totalled: true),
            Col("payment", "Payment", "money", totalled: true),
            Col("balance", "Balance", "money"),
        };

        // ── Cash Book / Bank Book ─────────────────────────────────────────────────

        public async Task<CashBookResultDto> GetCashBookAsync(int companyId,
            ReportFilterDto filter, string kind)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var isCash = kind.Equals("cash", StringComparison.OrdinalIgnoreCase);
            var title = filter.AccountId.HasValue
                ? (isCash ? "Cash Book" : "Bank Book")
                : isCash ? "Cash Book — all cash accounts" : "Bank Book — all bank accounts";

            var envelope = await NewReportAsync(companyId, title, window, filter, glOn);
            var report = new CashBookResultDto
            {
                Title = envelope.Title,
                CompanyName = envelope.CompanyName,
                PeriodLabel = envelope.PeriodLabel,
                From = envelope.From,
                To = envelope.To,
                FiltersApplied = envelope.FiltersApplied,
                GeneratedAt = envelope.GeneratedAt,
                LedgerSourced = glOn,
                Columns = CashBookColumns,
            };

            if (!glOn)
            {
                // A cash book IS the ledger. With posting off there are no journal
                // lines, so there is nothing to show — say that plainly rather than
                // fabricating a book from the payments table, which would omit
                // transfers, journals and opening balances and silently disagree
                // with the Chart of Accounts.
                report.Notice = "This company does not post to the general ledger, so there is no cash book. "
                              + "Enable GL posting in Accounting → Dashboard to build one.";
                return report;
            }

            // An EXPLICIT account choice wins over the cash/bank split. The split is
            // only a default for "show me all of them" — an operator who named an
            // account wants that account's book, and refusing because they opened
            // the Bank Book rather than the Cash Book is pure friction. The account
            // must still be a money account of THIS company, so a foreign or
            // non-cash id is still rejected below.
            var candidates = await LoadCashBankAccountsAsync(
                companyId, filter.AccountId.HasValue ? "all" : kind);
            if (filter.AccountId.HasValue)
                candidates = candidates.Where(a => a.Id == filter.AccountId.Value).ToList();

            if (candidates.Count == 0)
            {
                report.Notice = filter.AccountId.HasValue
                    ? "That account is not a bank or cash account for this company."
                    : $"No {(isCash ? "cash" : "bank")} accounts are set up yet.";
                return report;
            }

            // Title follows the account actually shown, not the route taken.
            if (filter.AccountId.HasValue)
                report.Title = IsCashAccount(candidates[0]) ? "Cash Book" : "Bank Book";

            // Exact reuse: one account is literally its own ledger.
            if (candidates.Count == 1)
            {
                var account = candidates[0];
                var (page, size) = ResolvePaging(filter, forExport: false);
                var ledger = await _gl.GetAccountLedgerAsync(account.Id, window.From, window.To, page, size);
                if (ledger == null)
                {
                    report.Notice = "That account no longer exists.";
                    return report;
                }

                report.AccountId = account.Id;
                report.AccountName = account.Name;
                report.OpeningBalance = ledger.OpeningBalance;
                report.ClosingBalance = ledger.ClosingBalance;
                report.Page = ledger.Page;
                report.PageSize = ledger.PageSize;
                report.TotalCount = ledger.TotalCount;

                var contras = await LoadContraAccountsAsync(companyId,
                    ledger.Items.Select(i => i.JournalEntryId).Distinct().ToList(), account.Id);
                var refs = await LoadSourceReferencesAsync(companyId, ledger.Items
                    .Select(i => (i.SourceDocType, i.SourceDocId)).ToList());

                report.Rows = ledger.Items.Select(i => (object)new CashBookRowDto
                {
                    Date = i.Date,
                    JournalEntryId = i.JournalEntryId,
                    EntryNo = i.EntryNo,
                    SourceType = i.SourceDocType,
                    SourceId = i.SourceDocId,
                    Reference = refs.GetValueOrDefault((i.SourceDocType, i.SourceDocId)) ?? $"JE-{i.EntryNo}",
                    Description = FirstNonEmpty(i.Description, i.Narration),
                    Contra = contras.GetValueOrDefault(i.JournalEntryId),
                    Receipt = i.Debit,
                    Payment = i.Credit,
                    Balance = i.RunningBalance,
                }).ToList();

                await FillBookTotalsAsync(companyId, new[] { account.Id }, window, report, filter);
                return report;
            }

            // Several accounts: one interleaved book. Openings still come from the
            // GL balance primitive — only the running sum is local.
            await BuildCombinedBookAsync(companyId, candidates.Select(a => a.Id).ToList(),
                window, filter, report);
            return report;
        }

        /// <summary>
        /// A book over several bank/cash accounts, ordered as one chronological
        /// stream. Opening is Σ of each account's balance as at the day before the
        /// window — the same primitive the single-account path uses, so a combined
        /// book always reconciles to the sum of its parts.
        /// </summary>
        private async Task BuildCombinedBookAsync(int companyId, List<int> accountIds,
            ReportWindow window, ReportFilterDto filter, CashBookResultDto report)
        {
            report.OpeningBalance = await OpeningForAccountsAsync(companyId, accountIds, window.From);

            var lines = ScopeToDivisions(_context.JournalLines.AsNoTracking()
                .Where(l => accountIds.Contains(l.AccountId)
                         && l.JournalEntry.CompanyId == companyId), filter);
            if (window.From.HasValue) lines = lines.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) lines = lines.Where(l => l.JournalEntry.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue)
                lines = lines.Where(l => l.JournalEntry.DivisionId == filter.DivisionId!.Value
                                      || l.DivisionId == filter.DivisionId!.Value);

            var ordered = lines
                .OrderBy(l => l.JournalEntry.Date)
                .ThenBy(l => l.JournalEntryId)
                .ThenBy(l => l.Id);

            report.TotalCount = await ordered.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;
            var offset = (page - 1) * size;

            // Balance carried into this page — same trick as GetAccountLedgerAsync:
            // sum the net of the rows before the page under identical ordering.
            var beforePage = offset > 0
                ? await ordered.Take(offset).SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var pageRows = await ordered.Skip(offset).Take(size)
                .Select(l => new
                {
                    l.Id,
                    l.JournalEntryId,
                    l.JournalEntry.EntryNo,
                    l.JournalEntry.Date,
                    l.JournalEntry.SourceDocType,
                    l.JournalEntry.SourceDocId,
                    l.JournalEntry.Narration,
                    l.Description,
                    l.Debit,
                    l.Credit,
                    l.AccountId,
                    AccountName = l.Account.Name,
                })
                .ToListAsync();

            var contras = await LoadContraAccountsAsync(companyId,
                pageRows.Select(r => r.JournalEntryId).Distinct().ToList(), excludeAccountId: null,
                excludeAccountIds: accountIds);
            var refs = await LoadSourceReferencesAsync(companyId,
                pageRows.Select(r => (r.SourceDocType.ToString(), r.SourceDocId)).ToList());

            var running = report.OpeningBalance + beforePage;
            var built = new List<object>(pageRows.Count);
            foreach (var r in pageRows)
            {
                running += r.Debit - r.Credit;
                built.Add(new CashBookRowDto
                {
                    Date = r.Date,
                    JournalEntryId = r.JournalEntryId,
                    EntryNo = r.EntryNo,
                    SourceType = r.SourceDocType.ToString(),
                    SourceId = r.SourceDocId,
                    Reference = refs.GetValueOrDefault((r.SourceDocType.ToString(), r.SourceDocId)) ?? $"JE-{r.EntryNo}",
                    // With several accounts in one stream, which one moved matters.
                    Description = FirstNonEmpty(r.Description, r.Narration) is { } d
                        ? $"{r.AccountName} — {d}" : r.AccountName,
                    Contra = contras.GetValueOrDefault(r.JournalEntryId),
                    Receipt = r.Debit,
                    Payment = r.Credit,
                    Balance = running,
                });
            }
            report.Rows = built;

            await FillBookTotalsAsync(companyId, accountIds, window, report, filter);
            report.ClosingBalance = report.OpeningBalance + report.TotalReceipts - report.TotalPayments;
        }

        /// <summary>
        /// Balance carried into the window for a set of accounts. When the window has
        /// a start, that is <c>GetAccountBalancesAsync(asAt: from − 1 day)</c> — CoA
        /// opening plus every movement before the window, exactly as the account
        /// ledger computes it. With no start there is nothing before the window, so
        /// the opening is the stored Chart-of-Accounts opening balance.
        /// </summary>
        private async Task<decimal> OpeningForAccountsAsync(int companyId, List<int> accountIds, DateTime? from)
        {
            if (from.HasValue)
            {
                var balances = await _gl.GetAccountBalancesAsync(companyId, from.Value.Date.AddDays(-1));
                return accountIds.Sum(id => balances.GetValueOrDefault(id));
            }

            return await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && accountIds.Contains(a.Id))
                .SumAsync(a => a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance);
        }

        /// <summary>Receipts and payments over the WHOLE window, so the footer never
        /// reflects only the visible page.</summary>
        private async Task FillBookTotalsAsync(int companyId, IEnumerable<int> accountIds,
            ReportWindow window, CashBookResultDto report, ReportFilterDto filter)
        {
            var ids = accountIds.ToList();
            var q = ScopeToDivisions(_context.JournalLines.AsNoTracking()
                .Where(l => ids.Contains(l.AccountId) && l.JournalEntry.CompanyId == companyId), filter);
            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);

            var totals = await q.GroupBy(_ => 1)
                .Select(g => new { Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .FirstOrDefaultAsync();

            report.TotalReceipts = totals?.Dr ?? 0m;
            report.TotalPayments = totals?.Cr ?? 0m;
            report.Totals["receipt"] = report.TotalReceipts;
            report.Totals["payment"] = report.TotalPayments;
            report.Totals["netMovement"] = report.TotalReceipts - report.TotalPayments;
            report.TotalLabels["receipt"] = "Total Receipts";
            report.TotalLabels["payment"] = "Total Payments";
            report.TotalLabels["netMovement"] = "Net Movement";
        }

        /// <summary>
        /// The other side of each entry — what the money came from or went to. One
        /// account name when the entry has a single opposite leg, "Multiple" when it
        /// has several (a receipt settling four invoices). Batched: one query for the
        /// whole page.
        /// </summary>
        private async Task<Dictionary<int, string>> LoadContraAccountsAsync(int companyId,
            List<int> entryIds, int? excludeAccountId, List<int>? excludeAccountIds = null)
        {
            var result = new Dictionary<int, string>();
            if (entryIds.Count == 0) return result;

            var exclude = excludeAccountIds ?? new List<int>();
            if (excludeAccountId.HasValue) exclude = exclude.Append(excludeAccountId.Value).ToList();

            var rows = await _context.JournalLines.AsNoTracking()
                .Where(l => entryIds.Contains(l.JournalEntryId)
                         && l.JournalEntry.CompanyId == companyId
                         && !exclude.Contains(l.AccountId))
                .Select(l => new { l.JournalEntryId, AccountName = l.Account.Name })
                .ToListAsync();

            foreach (var g in rows.GroupBy(r => r.JournalEntryId))
            {
                var names = g.Select(r => r.AccountName).Distinct().ToList();
                result[g.Key] = names.Count == 1 ? names[0] : $"Multiple ({names.Count})";
            }
            return result;
        }

        /// <summary>
        /// Human document numbers for the source documents on a page — PMT-0042,
        /// BILL-308, INV-1041. The ledger stores only a type and an id, and an
        /// operator cannot reconcile a book against "Payment #57".
        /// </summary>
        private async Task<Dictionary<(string Type, int? Id), string>> LoadSourceReferencesAsync(
            int companyId, List<(string Type, int? Id)> sources)
        {
            var map = new Dictionary<(string, int?), string>();
            var wanted = sources.Where(s => s.Id.HasValue).Distinct().ToList();
            if (wanted.Count == 0) return map;

            var paymentIds = Ids(wanted, nameof(SourceDocType.Payment));
            if (paymentIds.Count > 0)
                foreach (var p in await _context.Payments.AsNoTracking()
                             .Where(p => p.CompanyId == companyId && paymentIds.Contains(p.Id))
                             .Select(p => new { p.Id, p.Number, p.Direction }).ToListAsync())
                    map[(nameof(SourceDocType.Payment), p.Id)] = PaymentRef(p.Direction, p.Number);

            var invoiceIds = Ids(wanted, nameof(SourceDocType.Invoice));
            if (invoiceIds.Count > 0)
                foreach (var i in await _context.Invoices.AsNoTracking()
                             .Where(i => i.CompanyId == companyId && invoiceIds.Contains(i.Id))
                             .Select(i => new { i.Id, i.InvoiceNumber, i.DocumentType }).ToListAsync())
                    map[(nameof(SourceDocType.Invoice), i.Id)] = i.DocumentType switch
                    {
                        10 => $"CN-{i.InvoiceNumber}",
                        9 => $"DN-{i.InvoiceNumber}",
                        _ => $"INV-{i.InvoiceNumber}",
                    };

            var billIds = Ids(wanted, nameof(SourceDocType.PurchaseBill));
            if (billIds.Count > 0)
                foreach (var b in await _context.PurchaseBills.AsNoTracking()
                             .Where(b => b.CompanyId == companyId && billIds.Contains(b.Id))
                             .Select(b => new { b.Id, b.PurchaseBillNumber }).ToListAsync())
                    map[(nameof(SourceDocType.PurchaseBill), b.Id)] = $"BILL-{b.PurchaseBillNumber}";

            var transferIds = Ids(wanted, nameof(SourceDocType.AccountTransfer));
            if (transferIds.Count > 0)
                foreach (var t in await _context.AccountTransfers.AsNoTracking()
                             .Where(t => t.CompanyId == companyId && transferIds.Contains(t.Id))
                             .Select(t => new { t.Id, t.Number }).ToListAsync())
                    map[(nameof(SourceDocType.AccountTransfer), t.Id)] = $"TRF-{t.Number:D4}";

            return map;

            static List<int> Ids(List<(string Type, int? Id)> src, string type) =>
                src.Where(s => s.Type == type).Select(s => s.Id!.Value).Distinct().ToList();
        }

        // ── Cash &amp; Bank Summary ────────────────────────────────────────────────

        public async Task<ReportResultDto> GetCashBankSummaryAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var report = await NewReportAsync(companyId, "Cash & Bank Summary", window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("account", "Account"),
                Col("kind", "Type"),
                Col("opening", "Opening", "money", totalled: true),
                Col("receipts", "Receipts", "money", totalled: true),
                Col("payments", "Payments", "money", totalled: true),
                Col("closing", "Closing", "money", totalled: true),
                Col("unclearedCheques", "Uncleared cheques", "money", totalled: true),
            };

            var accounts = await LoadCashBankAccountsAsync(companyId, "all");
            if (accounts.Count == 0 || !glOn)
            {
                if (!glOn)
                    report.Notice = "Balances come from the general ledger, which is off for this company. "
                                  + "Enable GL posting in Accounting → Dashboard.";
                return report;
            }

            var ids = accounts.Select(a => a.Id).ToList();

            // Closing reuses the GL balance primitive — the same numbers the
            // Chart of Accounts and the accounting dashboard show.
            var closing = await _gl.GetAccountBalancesAsync(companyId, window.To);
            var openingMap = window.From.HasValue
                ? await _gl.GetAccountBalancesAsync(companyId, window.From.Value.Date.AddDays(-1))
                : accounts.ToDictionary(a => a.Id,
                    a => a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance);

            var movementQuery = ScopeToDivisions(_context.JournalLines.AsNoTracking()
                .Where(l => ids.Contains(l.AccountId) && l.JournalEntry.CompanyId == companyId), filter);
            if (window.From.HasValue)
                movementQuery = movementQuery.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue)
                movementQuery = movementQuery.Where(l => l.JournalEntry.Date <= window.To!.Value);

            var movement = (await movementQuery
                .GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .ToListAsync())
                .ToDictionary(x => x.AccountId, x => (x.Dr, x.Cr));

            // Cheques written/received against each account but not yet cleared —
            // the gap between the ledger balance and genuinely available money.
            var uncleared = (await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled
                         && p.BankAccountId != null
                         && (p.ChequeStatus == ChequeStatus.Pending || p.ChequeStatus == ChequeStatus.Deposited))
                .GroupBy(p => p.BankAccountId!.Value)
                .Select(g => new { AccountId = g.Key, Amount = g.Sum(x => x.Amount) })
                .ToListAsync())
                .ToDictionary(x => x.AccountId, x => x.Amount);

            var rows = accounts.Select(a =>
            {
                var mv = movement.GetValueOrDefault(a.Id);
                return new CashBankSummaryRowDto
                {
                    AccountId = a.Id,
                    Account = a.Name,
                    Code = a.Code,
                    Kind = CashKindLabel(a),
                    Opening = openingMap.GetValueOrDefault(a.Id),
                    Receipts = mv.Item1,
                    Payments = mv.Item2,
                    Closing = closing.GetValueOrDefault(a.Id),
                    UnclearedCheques = uncleared.GetValueOrDefault(a.Id),
                };
            })
            .OrderByDescending(r => r.Closing)
            .ToList();

            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["closing"] = rows.Sum(r => r.Closing);
            report.Totals["opening"] = rows.Sum(r => r.Opening);
            report.Totals["receipts"] = rows.Sum(r => r.Receipts);
            report.Totals["payments"] = rows.Sum(r => r.Payments);
            report.Totals["unclearedCheques"] = rows.Sum(r => r.UnclearedCheques);
            // Closing first: "how much money do we have" is the question this
            // report exists to answer, and the UI shows totals in insertion order.
            report.TotalLabels["closing"] = "Cash & Bank Total";
            report.TotalLabels["opening"] = "Opening";
            report.TotalLabels["receipts"] = "Receipts In";
            report.TotalLabels["payments"] = "Payments Out";
            report.TotalLabels["unclearedCheques"] = "Uncleared Cheques";
            return report;
        }

        // ── Payments / Receipts register ──────────────────────────────────────────

        public async Task<ReportResultDto> GetMoneyRegisterAsync(int companyId,
            ReportFilterDto filter, bool receipts)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                receipts ? "Receipt Register" : "Payment Register", window, filter,
                // These reports read the payment subledger, which exists whether or
                // not the ledger is on, so they are always complete for their scope.
                ledgerSourced: false);
            report.LedgerSourced = true;
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("documentNo", receipts ? "Receipt No." : "Payment No."),
                Col("contact", receipts ? "Received from" : "Payee"),
                Col("contactType", receipts ? "Payer Type" : "Payee Type"),
                Col("paymentAccount", receipts ? "Received into" : "Paid from"),
                Col("method", "Method"),
                Col("appliedTo", "Applied to"),
                Col("amount", "Amount", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
                Col("reference", "Reference"),
                Col("status", "Status", "status"),
            };

            var q = BuildPaymentQuery(companyId, filter, window, receipts);

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .Skip((page - 1) * size).Take(size)
                .Select(p => new
                {
                    p.Id, p.Number, p.Date, p.Direction,
                    p.ContactType, p.ContactId, p.ContactName,
                    p.BankAccountId, p.BankAccountName, p.Method,
                    p.ChequeNumber, p.ChequeDate, p.ChequeStatus,
                    p.Description, p.Amount, p.IsCancelled, p.ReconciledDate, p.DivisionId,
                })
                .ToListAsync();

            var ids = rows.Select(r => r.Id).ToList();
            var partyNames = await LoadPartyNamesAsync(companyId, rows.Select(r => ((string?)r.ContactType, r.ContactId)));
            var applied = await SummariseAllocationsAsync(companyId, ids);
            var taxes = ids.Count == 0
                ? new Dictionary<int, decimal>()
                : (await _context.PaymentAllocations.AsNoTracking()
                    .Where(a => ids.Contains(a.PaymentId) && a.TaxAmount != 0m)
                    .GroupBy(a => a.PaymentId)
                    .Select(g => new { PaymentId = g.Key, Tax = g.Sum(x => x.TaxAmount) })
                    .ToListAsync())
                    .ToDictionary(x => x.PaymentId, x => x.Tax);

            var accountIds = rows.Where(r => r.BankAccountId.HasValue)
                .Select(r => r.BankAccountId!.Value).Distinct().ToList();
            var accountNames = accountIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && accountIds.Contains(a.Id))
                    .ToDictionaryAsync(a => a.Id, a => a.Name);

            var divisionIds = rows.Where(r => r.DivisionId.HasValue).Select(r => r.DivisionId!.Value).Distinct().ToList();
            var divisionNames = divisionIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Divisions.AsNoTracking()
                    .Where(d => d.CompanyId == companyId && divisionIds.Contains(d.Id))
                    .ToDictionaryAsync(d => d.Id, d => d.Name);

            report.Rows = rows.Select(r => (object)new MoneyRegisterRowDto
            {
                PaymentId = r.Id,
                Date = r.Date,
                DocumentNo = PaymentRef(r.Direction, r.Number),
                Contact = ResolvePartyName(partyNames, r.ContactType, r.ContactId, r.ContactName),
                ContactType = r.ContactType,
                ContactId = r.ContactId,
                PaymentAccountId = r.BankAccountId,
                PaymentAccount = r.BankAccountId.HasValue
                    ? accountNames.GetValueOrDefault(r.BankAccountId.Value) ?? r.BankAccountName
                    : r.BankAccountName,
                Method = r.Method,
                AppliedTo = applied.GetValueOrDefault(r.Id),
                Amount = r.Amount,
                Tax = taxes.GetValueOrDefault(r.Id),
                Reference = r.ChequeNumber,
                Description = r.Description,
                Status = DescribePaymentStatus(r.IsCancelled, r.ChequeStatus, r.ReconciledDate),
                Division = r.DivisionId.HasValue ? divisionNames.GetValueOrDefault(r.DivisionId.Value) : null,
            }).ToList();

            report.Totals["amount"] = await q.SumAsync(p => (decimal?)p.Amount) ?? 0m;
            report.Totals["tax"] = await _context.PaymentAllocations.AsNoTracking()
                .Where(a => q.Any(p => p.Id == a.PaymentId))
                .SumAsync(a => (decimal?)a.TaxAmount) ?? 0m;
            report.Totals["transactionCount"] = report.TotalCount;
            report.TotalLabels["amount"] = receipts ? "Total Received" : "Total Paid";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["transactionCount"] = receipts ? "Receipts" : "Payments";
            return report;
        }

        /// <summary>
        /// Payments/receipts narrowed by the shared filter set.
        ///
        /// Cancelled documents are EXCLUDED unless explicitly asked for
        /// (<c>status=cancelled</c>). A void payment keeps its number but contributes
        /// nothing to any balance, so including it by default would make the
        /// register's total disagree with the cash book for no visible reason.
        /// </summary>
        private IQueryable<Payment> BuildPaymentQuery(int companyId, ReportFilterDto f,
            ReportWindow window, bool receipts)
        {
            var direction = receipts ? PaymentDirection.Receipt : PaymentDirection.Payment;
            var wantCancelled = string.Equals(f.Status, "cancelled", StringComparison.OrdinalIgnoreCase);

            var q = ScopePaymentsToDivisions(_context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && p.Direction == direction), f);

            q = wantCancelled ? q.Where(p => p.IsCancelled) : q.Where(p => !p.IsCancelled);

            if (window.From.HasValue) q = q.Where(p => p.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(p => p.Date <= window.To!.Value);
            if (f.DivisionId.HasValue) q = q.Where(p => p.DivisionId == f.DivisionId!.Value);
            if (f.PaymentAccountId.HasValue) q = q.Where(p => p.BankAccountId == f.PaymentAccountId!.Value);
            if (f.PayeeType is "Client" or "Supplier" or "Other") q = q.Where(p => p.ContactType == f.PayeeType);

            var partyId = f.PayeeId ?? (receipts ? f.ClientId : f.SupplierId);
            if (partyId.HasValue) q = q.Where(p => p.ContactId == partyId.Value);

            // The account filter means "money applied to this account" — an
            // allocation target, not the bank account.
            if (f.AccountId.HasValue)
                q = q.Where(p => p.Allocations.Any(a => a.AccountId == f.AccountId!.Value));

            if (!string.IsNullOrWhiteSpace(f.Tax))
            {
                var tax = f.Tax.Trim().ToLowerInvariant();
                if (tax == "taxed") q = q.Where(p => p.Allocations.Any(a => a.TaxAmount != 0m));
                else if (tax == "untaxed") q = q.Where(p => !p.Allocations.Any(a => a.TaxAmount != 0m));
                else if (decimal.TryParse(tax, out var rate))
                    q = q.Where(p => p.Allocations.Any(a => a.TaxRate == rate));
            }

            if (!string.IsNullOrWhiteSpace(f.Status) && !wantCancelled)
            {
                switch (f.Status.Trim().ToLowerInvariant())
                {
                    case "cheque":
                    case "chequepending":
                        q = q.Where(p => p.ChequeStatus == ChequeStatus.Pending); break;
                    case "chequecleared":
                        q = q.Where(p => p.ChequeStatus == ChequeStatus.Cleared); break;
                    case "bounced":
                        q = q.Where(p => p.ChequeStatus == ChequeStatus.Bounced); break;
                    case "reconciled":
                        q = q.Where(p => p.ReconciledDate != null); break;
                    case "unreconciled":
                        q = q.Where(p => p.ReconciledDate == null); break;
                }
            }

            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(p => (p.Description != null && EF.Functions.Like(p.Description, $"%{s}%"))
                              || (p.ContactName != null && EF.Functions.Like(p.ContactName, $"%{s}%"))
                              || (p.ChequeNumber != null && EF.Functions.Like(p.ChequeNumber, $"%{s}%"))
                              || (p.BankAccountName != null && EF.Functions.Like(p.BankAccountName, $"%{s}%")));
            }

            return q;
        }

        /// <summary>
        /// "Applied to" for a page of payments: the settled document numbers, the
        /// income/expense accounts, or an advance. One batched query — a register of
        /// 100 payments must not issue 100 lookups.
        /// </summary>
        private async Task<Dictionary<int, string>> SummariseAllocationsAsync(int companyId, List<int> paymentIds)
        {
            var result = new Dictionary<int, string>();
            if (paymentIds.Count == 0) return result;

            var allocations = await _context.PaymentAllocations.AsNoTracking()
                .Where(a => paymentIds.Contains(a.PaymentId))
                .Select(a => new
                {
                    a.PaymentId, a.Kind, a.InvoiceId, a.PurchaseBillId, a.AccountId,
                    AccountName = a.Account != null ? a.Account.Name : null,
                    InvoiceNumber = a.Invoice != null ? (int?)a.Invoice.InvoiceNumber : null,
                    BillNumber = a.PurchaseBill != null ? (int?)a.PurchaseBill.PurchaseBillNumber : null,
                })
                .ToListAsync();

            foreach (var g in allocations.GroupBy(a => a.PaymentId))
            {
                var labels = new List<string>();
                foreach (var a in g)
                {
                    if (a.Kind == AllocationKind.OnAccount) labels.Add("On account (advance)");
                    else if (a.InvoiceNumber.HasValue) labels.Add($"INV-{a.InvoiceNumber}");
                    else if (a.BillNumber.HasValue) labels.Add($"BILL-{a.BillNumber}");
                    else if (!string.IsNullOrWhiteSpace(a.AccountName)) labels.Add(a.AccountName!);
                }
                var distinct = labels.Distinct().ToList();
                // Long lists get truncated: one receipt in the legacy data clears
                // seven bills, and a register cell is not the place for all of them.
                result[g.Key] = distinct.Count <= 3
                    ? string.Join(", ", distinct)
                    : $"{string.Join(", ", distinct.Take(3))} +{distinct.Count - 3} more";
            }
            return result;
        }

        private static string DescribePaymentStatus(bool cancelled, ChequeStatus cheque, DateTime? reconciled)
        {
            if (cancelled) return "Cancelled";
            return cheque switch
            {
                ChequeStatus.Pending => "Cheque pending",
                ChequeStatus.Deposited => "Cheque deposited",
                ChequeStatus.Bounced => "Cheque bounced",
                ChequeStatus.Cleared => "Cleared",
                _ => reconciled.HasValue ? "Reconciled" : "Recorded",
            };
        }

        // ── Payment / Receipt by account ──────────────────────────────────────────

        public async Task<ReportResultDto> GetMoneyByAccountAsync(int companyId,
            ReportFilterDto filter, bool receipts)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                receipts ? "Receipts by Account" : "Payments by Account", window, filter,
                ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", "Applied to"),
                Col("amount", "Amount", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
                Col("count", "Transactions", "int"),
            };

            var payments = BuildPaymentQuery(companyId, filter, window, receipts);

            var allocations = _context.PaymentAllocations.AsNoTracking()
                .Where(a => payments.Any(p => p.Id == a.PaymentId));

            // Direct income/expense lines group by their account.
            var byAccount = await allocations
                .Where(a => a.Kind == AllocationKind.Account && a.AccountId != null)
                .GroupBy(a => new { AccountId = a.AccountId!.Value, Name = a.Account!.Name })
                .Select(g => new
                {
                    g.Key.AccountId, g.Key.Name,
                    Amount = g.Sum(x => x.Amount),
                    Tax = g.Sum(x => x.TaxAmount),
                    Count = g.Select(x => x.PaymentId).Distinct().Count(),
                })
                .ToListAsync();

            // Document settlements aren't an account choice — they clear AR/AP — so
            // they get one bucket each rather than being forced into the account list.
            var settled = await allocations
                .Where(a => a.Kind == AllocationKind.Document)
                .GroupBy(a => a.InvoiceId != null)
                .Select(g => new
                {
                    IsInvoice = g.Key,
                    Amount = g.Sum(x => x.Amount),
                    Count = g.Select(x => x.PaymentId).Distinct().Count(),
                })
                .ToListAsync();

            var onAccount = await allocations
                .Where(a => a.Kind == AllocationKind.OnAccount)
                .GroupBy(_ => 1)
                .Select(g => new { Amount = g.Sum(x => x.Amount), Count = g.Select(x => x.PaymentId).Distinct().Count() })
                .FirstOrDefaultAsync();

            var rows = byAccount.Select(a => new ReportGroupRowDto
            {
                DrillKey = a.AccountId.ToString(),
                Label = a.Name,
                Amount = a.Amount,
                Tax = a.Tax,
                Count = a.Count,
            }).ToList();

            foreach (var s in settled)
                rows.Add(new ReportGroupRowDto
                {
                    DrillKey = null,
                    Label = s.IsInvoice ? "Sales invoices settled" : "Purchase bills settled",
                    Amount = s.Amount,
                    Count = s.Count,
                });

            if (onAccount != null && onAccount.Amount != 0m)
                rows.Add(new ReportGroupRowDto
                {
                    DrillKey = null,
                    Label = "On account (advances)",
                    Amount = onAccount.Amount,
                    Count = onAccount.Count,
                });

            rows = rows.OrderByDescending(r => r.Amount).ToList();
            report.Rows = rows.Cast<object>().ToList();
            report.TotalCount = rows.Count;
            report.Page = 1;
            report.PageSize = rows.Count;
            report.Totals["amount"] = rows.Sum(r => r.Amount);
            report.Totals["tax"] = rows.Sum(r => r.Tax);
            report.TotalLabels["amount"] = receipts ? "Total Received" : "Total Paid";
            report.TotalLabels["tax"] = "Total Tax";
            return report;
        }

        // ── Cheque registers ──────────────────────────────────────────────────────

        public async Task<ReportResultDto> GetChequeRegisterAsync(int companyId,
            ReportFilterDto filter, bool issued)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId,
                issued ? "Cheques Issued" : "Cheques in Hand", window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Recorded", "date"),
                Col("documentNo", issued ? "Payment No." : "Receipt No."),
                Col("contact", issued ? "Payee" : "Received from"),
                Col("chequeNumber", "Cheque No."),
                Col("chequeDate", "Cheque Date", "date"),
                Col("chequeStatus", "Status", "status"),
                Col("daysToDue", "Days to due", "int"),
                Col("paymentAccount", issued ? "Paid from" : "Deposit to"),
                Col("amount", "Amount", "money", totalled: true),
            };

            var direction = issued ? PaymentDirection.Payment : PaymentDirection.Receipt;

            // Uncleared only: Pending (written/received, not banked) and Deposited
            // (banked, not yet cleared). A cleared cheque is just cash and belongs in
            // the register of payments, not here.
            var q = ScopePaymentsToDivisions(_context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && p.Direction == direction && !p.IsCancelled
                         && (p.ChequeStatus == ChequeStatus.Pending
                             || p.ChequeStatus == ChequeStatus.Deposited)), filter);

            if (window.From.HasValue) q = q.Where(p => p.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(p => p.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue) q = q.Where(p => p.DivisionId == filter.DivisionId!.Value);
            if (filter.PaymentAccountId.HasValue) q = q.Where(p => p.BankAccountId == filter.PaymentAccountId!.Value);
            if (filter.PayeeId.HasValue) q = q.Where(p => p.ContactId == filter.PayeeId!.Value);
            if (!string.IsNullOrWhiteSpace(filter.Status))
            {
                var s = filter.Status.Trim().ToLowerInvariant();
                if (s == "pending") q = q.Where(p => p.ChequeStatus == ChequeStatus.Pending);
                else if (s == "deposited") q = q.Where(p => p.ChequeStatus == ChequeStatus.Deposited);
                else if (s == "overdue") q = q.Where(p => p.ChequeDate != null && p.ChequeDate < PakistanClock.Today);
            }

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                // Soonest-due first: this report exists to answer "what lands next".
                .OrderBy(p => p.ChequeDate ?? p.Date).ThenBy(p => p.Number)
                .Skip((page - 1) * size).Take(size)
                .Select(p => new
                {
                    p.Id, p.Number, p.Date, p.Direction, p.ContactType, p.ContactId, p.ContactName,
                    p.ChequeNumber, p.ChequeDate, p.ChequeStatus, p.BankAccountId, p.BankAccountName, p.Amount,
                })
                .ToListAsync();

            var today = PakistanClock.Today;
            var partyNames = await LoadPartyNamesAsync(companyId, rows.Select(r => ((string?)r.ContactType, r.ContactId)));
            var accountIds = rows.Where(r => r.BankAccountId.HasValue).Select(r => r.BankAccountId!.Value).Distinct().ToList();
            var accountNames = accountIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && accountIds.Contains(a.Id))
                    .ToDictionaryAsync(a => a.Id, a => a.Name);

            report.Rows = rows.Select(r => (object)new ChequeRowDto
            {
                PaymentId = r.Id,
                Date = r.Date,
                DocumentNo = PaymentRef(r.Direction, r.Number),
                Contact = ResolvePartyName(partyNames, r.ContactType, r.ContactId, r.ContactName),
                ChequeNumber = r.ChequeNumber,
                ChequeDate = r.ChequeDate,
                ChequeStatus = r.ChequeStatus.ToString(),
                DaysToDue = r.ChequeDate.HasValue ? (int)(r.ChequeDate.Value.Date - today).TotalDays : null,
                PaymentAccount = r.BankAccountId.HasValue
                    ? accountNames.GetValueOrDefault(r.BankAccountId.Value) ?? r.BankAccountName
                    : r.BankAccountName,
                Amount = r.Amount,
                // A cheque dated after the day it was recorded is post-dated — the
                // reality this product's PDC handling exists for.
                IsPostDated = r.ChequeDate.HasValue && r.ChequeDate.Value.Date > r.Date.Date,
            }).ToList();

            report.Totals["amount"] = await q.SumAsync(p => (decimal?)p.Amount) ?? 0m;
            report.Totals["transactionCount"] = report.TotalCount;
            report.Totals["overdueAmount"] = await q
                .Where(p => p.ChequeDate != null && p.ChequeDate < today)
                .SumAsync(p => (decimal?)p.Amount) ?? 0m;
            report.TotalLabels["amount"] = issued ? "Total Issued" : "Total in Hand";
            report.TotalLabels["transactionCount"] = "Cheques";
            report.TotalLabels["overdueAmount"] = "Past Due";
            return report;
        }

        // ── Unallocated / on-account money ────────────────────────────────────────

        public async Task<ReportResultDto> GetUnallocatedPaymentsAsync(int companyId, ReportFilterDto filter)
        {
            var window = ResolveWindow(filter);
            var report = await NewReportAsync(companyId, "Unallocated Payments & Receipts",
                window, filter, ledgerSourced: true);
            report.Columns = new List<ReportColumnDto>
            {
                Col("date", "Date", "date"),
                Col("documentNo", "Document No."),
                Col("direction", "Type"),
                Col("contact", "Party"),
                Col("contactType", "Party Type"),
                Col("paymentAccount", "Account"),
                Col("amount", "Unallocated", "money", totalled: true),
                Col("ageDays", "Age (days)", "int"),
                Col("description", "Description"),
            };

            var q = from a in _context.PaymentAllocations.AsNoTracking()
                    join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                    where p.CompanyId == companyId && !p.IsCancelled
                          && a.Kind == AllocationKind.OnAccount
                    select new { Alloc = a, Payment = p };

            if (filter.AllowedDivisionIds != null)
            {
                var allowedDivisions = filter.AllowedDivisionIds;
                q = q.Where(x => x.Payment.DivisionId == null
                              || allowedDivisions.Contains(x.Payment.DivisionId.Value));
            }
            if (window.From.HasValue) q = q.Where(x => x.Payment.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(x => x.Payment.Date <= window.To!.Value);
            if (filter.DivisionId.HasValue) q = q.Where(x => x.Payment.DivisionId == filter.DivisionId!.Value);
            if (filter.PayeeType is "Client" or "Supplier" or "Other")
                q = q.Where(x => x.Payment.ContactType == filter.PayeeType);
            var partyId = filter.PayeeId ?? filter.ClientId ?? filter.SupplierId;
            if (partyId.HasValue) q = q.Where(x => x.Payment.ContactId == partyId.Value);

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(filter, forExport: false);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                // Oldest first: an advance that has sat unabsorbed for months is the
                // one worth chasing.
                .OrderBy(x => x.Payment.Date).ThenBy(x => x.Payment.Number)
                .Skip((page - 1) * size).Take(size)
                .Select(x => new
                {
                    x.Payment.Id, x.Payment.Number, x.Payment.Date, x.Payment.Direction,
                    x.Payment.ContactType, x.Payment.ContactId, x.Payment.ContactName,
                    x.Payment.BankAccountId, x.Payment.BankAccountName, x.Payment.Description,
                    x.Alloc.Amount,
                })
                .ToListAsync();

            var today = PakistanClock.Today;
            var partyNames = await LoadPartyNamesAsync(companyId, rows.Select(r => ((string?)r.ContactType, r.ContactId)));
            var accountIds = rows.Where(r => r.BankAccountId.HasValue).Select(r => r.BankAccountId!.Value).Distinct().ToList();
            var accountNames = accountIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && accountIds.Contains(a.Id))
                    .ToDictionaryAsync(a => a.Id, a => a.Name);

            report.Rows = rows.Select(r => (object)new UnallocatedRowDto
            {
                PaymentId = r.Id,
                Date = r.Date,
                DocumentNo = PaymentRef(r.Direction, r.Number),
                Direction = r.Direction == PaymentDirection.Receipt ? "Receipt" : "Payment",
                Contact = ResolvePartyName(partyNames, r.ContactType, r.ContactId, r.ContactName),
                ContactType = r.ContactType,
                ContactId = r.ContactId,
                PaymentAccount = r.BankAccountId.HasValue
                    ? accountNames.GetValueOrDefault(r.BankAccountId.Value) ?? r.BankAccountName
                    : r.BankAccountName,
                Amount = r.Amount,
                Description = r.Description,
                AgeDays = (int)(today - r.Date.Date).TotalDays,
            }).ToList();

            report.Totals["amount"] = await q.SumAsync(x => (decimal?)x.Alloc.Amount) ?? 0m;
            report.Totals["transactionCount"] = report.TotalCount;
            report.TotalLabels["amount"] = "Unallocated Total";
            report.TotalLabels["transactionCount"] = "Documents";
            return report;
        }
    }
}
