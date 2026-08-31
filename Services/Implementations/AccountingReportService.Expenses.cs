using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// The expense report family — "where did the company's money go".
    ///
    /// ── Why the general ledger and not the payments table ──
    /// An expense can reach the books three ways: a payment allocated straight to an
    /// expense account ("paid the electricity bill"), a purchase bill for a
    /// non-inventory company, or a manual journal (an accrual, a depreciation
    /// charge, a correction). Reading <c>PaymentAllocations</c> would show only the
    /// first and quietly understate the company's spend.
    ///
    /// So the query reads every DEBIT to an Expense account from
    /// <c>JournalLines</c> — complete and identical to what the P&amp;L will show —
    /// then enriches each row from its source document to recover the columns the
    /// ledger doesn't carry: payee, payment account, cheque reference.
    ///
    /// ── Row grain ──
    /// One row per (journal entry × expense account). <c>PostingService.AddLine</c>
    /// appends without merging, so one payment with two allocations to the same
    /// account writes two journal lines; summing at this grain both avoids a
    /// cartesian join against the allocations and stops the operator seeing two
    /// identical "Rent" rows for one payment.
    ///
    /// ── The tax column ──
    /// A taxed expense posts NET to the expense account and the recoverable slice to
    /// Input Tax as a sibling line (see <c>PostPaymentAsync</c>). So the ledger debit
    /// IS the subtotal, and tax is read back from <c>PaymentAllocation.TaxAmount</c>
    /// — authoritative, and it avoids pairing sibling journal lines positionally.
    /// Purchase-bill input tax sits at the bill header covering all its lines and is
    /// NOT apportioned across them here: that would be a derived number presented as
    /// a recorded one. Those figures belong to the tax reports.
    /// </summary>
    public partial class AccountingReportService
    {
        private static readonly List<ReportColumnDto> ExpenseColumns = new()
        {
            Col("date", "Date", "date"),
            Col("documentNo", "Payment / Expense No."),
            Col("payee", "Payee"),
            Col("payeeType", "Payee Type"),
            Col("description", "Description"),
            Col("expenseAccount", "Expense Account"),
            Col("paymentAccount", "Payment Account"),
            Col("subtotal", "Subtotal", "money", totalled: true),
            Col("tax", "Tax", "money", totalled: true),
            Col("total", "Total", "money", totalled: true),
            Col("reference", "Reference"),
        };

        public async Task<ReportResultDto> GetExpenseReportAsync(int companyId, ReportFilterDto filter,
            bool includeGroupSummaries = true, bool forExport = false)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);

            var report = await NewReportAsync(companyId,
                includeGroupSummaries ? "Company Expense Report" : "Expense Detail",
                window, filter, ledgerSourced: glOn);
            report.Columns = ExpenseColumns;

            if (!glOn)
            {
                // GL off: the ledger is empty, so fall back to the payment subledger.
                // Correct as far as it goes, and LedgerSourced=false tells the UI to
                // say it cannot see manual journals or accrued bills.
                await FillExpensesFromSubledgerAsync(companyId, filter, window, report,
                    includeGroupSummaries, forExport);
                return report;
            }

            var q = BuildExpenseLedgerQuery(companyId, filter, window);

            // Grain: (entry × account). Every field in the key is functionally
            // dependent on one of the two ids, so this still translates to one
            // GROUP BY in SQL.
            var grouped = q
                .GroupBy(x => new
                {
                    EntryId = x.JournalEntry.Id,
                    x.JournalEntry.Date,
                    x.JournalEntry.EntryNo,
                    x.JournalEntry.SourceDocType,
                    x.JournalEntry.SourceDocId,
                    x.JournalEntry.Narration,
                    EntryDivisionId = x.JournalEntry.DivisionId,
                    AccountId = x.Account.Id,
                    AccountName = x.Account.Name,
                    x.Account.AccountGroupId,
                })
                .Select(g => new
                {
                    g.Key,
                    Subtotal = g.Sum(x => x.Debit),
                    LineDescription = g.Min(x => x.Description),
                });

            report.TotalCount = await grouped.CountAsync();

            var (page, size) = ResolvePaging(filter, forExport);
            var rows = await grouped
                .OrderByDescending(x => x.Key.Date)
                .ThenByDescending(x => x.Key.EntryNo)
                .ThenBy(x => x.Key.AccountName)
                .Skip((page - 1) * size)
                .Take(size)
                .ToListAsync();

            report.Page = page;
            report.PageSize = size;
            if (forExport && report.TotalCount > ExportMaxRows)
                report.Notice = $"Showing the first {ExportMaxRows:N0} of {report.TotalCount:N0} rows.";

            // ── Enrichment: one batched query per source kind, never per row ──
            var paymentIds = rows.Where(r => r.Key.SourceDocType == SourceDocType.Payment && r.Key.SourceDocId.HasValue)
                .Select(r => r.Key.SourceDocId!.Value).Distinct().ToList();
            var billIds = rows.Where(r => r.Key.SourceDocType == SourceDocType.PurchaseBill && r.Key.SourceDocId.HasValue)
                .Select(r => r.Key.SourceDocId!.Value).Distinct().ToList();

            var payments = paymentIds.Count == 0
                ? new Dictionary<int, ExpensePaymentInfo>()
                : await _context.Payments.AsNoTracking()
                    .Where(p => p.CompanyId == companyId && paymentIds.Contains(p.Id))
                    .Select(p => new ExpensePaymentInfo
                    {
                        Id = p.Id, Number = p.Number, Direction = p.Direction,
                        ContactType = p.ContactType, ContactId = p.ContactId, ContactName = p.ContactName,
                        BankAccountId = p.BankAccountId, BankAccountName = p.BankAccountName,
                        ChequeNumber = p.ChequeNumber, Description = p.Description, Method = p.Method,
                    })
                    .ToDictionaryAsync(p => p.Id);

            var bills = billIds.Count == 0
                ? new Dictionary<int, ExpenseBillInfo>()
                : await _context.PurchaseBills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId && billIds.Contains(b.Id))
                    .Select(b => new ExpenseBillInfo
                    {
                        Id = b.Id, Number = b.PurchaseBillNumber, SupplierBillNumber = b.SupplierBillNumber,
                        SupplierId = b.SupplierId, SupplierName = b.Supplier!.Name,
                    })
                    .ToDictionaryAsync(b => b.Id);

            // Tax per (payment, expense account) — summed, matching the row grain.
            var taxByPaymentAccount = paymentIds.Count == 0
                ? new Dictionary<(int, int), decimal>()
                : (await _context.PaymentAllocations.AsNoTracking()
                    .Where(a => paymentIds.Contains(a.PaymentId)
                             && a.Kind == AllocationKind.Account && a.AccountId != null
                             && a.TaxAmount != 0m)
                    .GroupBy(a => new { a.PaymentId, AccountId = a.AccountId!.Value })
                    .Select(g => new { g.Key.PaymentId, g.Key.AccountId, Tax = g.Sum(x => x.TaxAmount) })
                    .ToListAsync())
                    .ToDictionary(x => (x.PaymentId, x.AccountId), x => x.Tax);

            var paymentAccountIds = payments.Values.Where(p => p.BankAccountId.HasValue)
                .Select(p => p.BankAccountId!.Value).Distinct().ToList();
            var paymentAccountNames = paymentAccountIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && paymentAccountIds.Contains(a.Id))
                    .ToDictionaryAsync(a => a.Id, a => a.Name);

            var groupIds = rows.Select(r => r.Key.AccountGroupId).Distinct().ToList();
            var groupNames = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId && groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id, g => g.Name);

            var divisionIds = rows.Where(r => r.Key.EntryDivisionId.HasValue)
                .Select(r => r.Key.EntryDivisionId!.Value).Distinct().ToList();
            var divisionNames = divisionIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Divisions.AsNoTracking()
                    .Where(d => d.CompanyId == companyId && divisionIds.Contains(d.Id))
                    .ToDictionaryAsync(d => d.Id, d => d.Name);

            var partyNames = await LoadPartyNamesAsync(companyId,
                payments.Values.Select(p => ((string?)p.ContactType, p.ContactId))
                    .Concat(bills.Values.Select(b => ((string?)"Supplier", (int?)b.SupplierId))));

            var built = new List<ExpenseReportRowDto>(rows.Count);
            foreach (var r in rows)
            {
                var k = r.Key;
                payments.TryGetValue(k.SourceDocId ?? 0, out var pay);
                bills.TryGetValue(k.SourceDocId ?? 0, out var bill);

                var tax = pay != null
                    ? taxByPaymentAccount.GetValueOrDefault((pay.Id, k.AccountId))
                    : 0m;

                built.Add(new ExpenseReportRowDto
                {
                    Date = k.Date,
                    DocumentNo = DescribeSource(k.SourceDocType, k.EntryNo, pay, bill),
                    SourceType = k.SourceDocType.ToString(),
                    SourceId = k.SourceDocId,
                    JournalEntryId = k.EntryId,

                    Payee = pay != null
                        ? ResolvePartyName(partyNames, pay.ContactType, pay.ContactId, pay.ContactName)
                        : bill != null ? bill.SupplierName : null,
                    PayeeType = pay?.ContactType ?? (bill != null ? "Supplier" : null),
                    PayeeId = pay?.ContactId ?? bill?.SupplierId,

                    Description = FirstNonEmpty(r.LineDescription, pay?.Description, k.Narration),

                    ExpenseAccountId = k.AccountId,
                    ExpenseAccount = k.AccountName,
                    ExpenseGroupId = k.AccountGroupId,
                    ExpenseGroup = groupNames.GetValueOrDefault(k.AccountGroupId),

                    PaymentAccountId = pay?.BankAccountId,
                    PaymentAccount = pay == null ? null
                        : pay.BankAccountId.HasValue
                            ? paymentAccountNames.GetValueOrDefault(pay.BankAccountId.Value) ?? pay.BankAccountName
                            : pay.BankAccountName,

                    Subtotal = r.Subtotal,
                    Tax = tax,
                    Total = r.Subtotal + tax,

                    Reference = FirstNonEmpty(pay?.ChequeNumber, bill?.SupplierBillNumber),
                    Division = k.EntryDivisionId.HasValue
                        ? divisionNames.GetValueOrDefault(k.EntryDivisionId.Value) : null,
                });
            }

            built = ApplySort(built, SafeSortKey(filter, ExpenseColumns), filter.SortDesc, ExpenseSortValue);
            report.Rows = built.Cast<object>().ToList();

            // Footer totals cover the WHOLE filtered set, not the page — a total that
            // only added up the visible rows would be actively misleading.
            await FillExpenseTotalsAsync(companyId, filter, window, report);

            if (includeGroupSummaries)
            {
                report.GroupSummaries.Add(await ExpenseSummaryByAccountAsync(companyId, filter, window));
                report.GroupSummaries.Add(await ExpenseSummaryByPayeeAsync(companyId, filter, window));
            }

            return report;
        }

        // ── Query construction ────────────────────────────────────────────────────

        /// <summary>
        /// Every debit to an Expense account, filtered. Kept as one place so the
        /// detail report, the totals and each grouped summary all narrow the data
        /// identically — a summary that disagreed with its own detail would destroy
        /// trust in the whole module.
        ///
        /// Navigates <c>JournalLine.JournalEntry</c> / <c>.Account</c> rather than
        /// joining explicitly: EF Core turns those into the same SQL joins, and it
        /// keeps the query a plain <c>IQueryable&lt;JournalLine&gt;</c> that composes
        /// and groups cleanly. Same style as <c>GeneralLedgerService</c>.
        /// </summary>
        private IQueryable<JournalLine> BuildExpenseLedgerQuery(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var q = _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && l.Account.AccountType == AccountType.Expense
                         && l.Debit > 0m);

            // RBAC first: a restricted caller cannot widen scope by omitting the
            // division filter.
            q = ScopeToDivisions(q, f);

            if (window.From.HasValue) q = q.Where(l => l.JournalEntry.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(l => l.JournalEntry.Date <= window.To!.Value);

            if (f.DivisionId.HasValue)
                q = q.Where(l => l.JournalEntry.DivisionId == f.DivisionId!.Value
                              || l.DivisionId == f.DivisionId!.Value);

            if (f.AccountId.HasValue)
                q = q.Where(l => l.AccountId == f.AccountId!.Value);

            if (f.AccountGroupId.HasValue)
                q = q.Where(l => l.Account.AccountGroupId == f.AccountGroupId!.Value);

            if (f.PayeeType is "Client" or "Supplier" or "Other")
            {
                // "Other" = a payee with no master row, so no party is tagged on the
                // line; Client/Supplier are tagged by the posting engine.
                q = f.PayeeType == "Other"
                    ? q.Where(l => l.PartyType == null)
                    : q.Where(l => l.PartyType == f.PayeeType);
            }

            if (f.PayeeId.HasValue)
                q = q.Where(l => l.PartyId == f.PayeeId!.Value);

            if (f.PaymentAccountId.HasValue)
                q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Payment
                              && _context.Payments.Any(p => p.Id == l.JournalEntry.SourceDocId
                                   && p.BankAccountId == f.PaymentAccountId!.Value));

            if (!string.IsNullOrWhiteSpace(f.Tax))
            {
                var tax = f.Tax.Trim().ToLowerInvariant();
                if (tax == "taxed")
                    q = q.Where(l => _context.PaymentAllocations.Any(pa =>
                        pa.Kind == AllocationKind.Account && pa.TaxAmount != 0m
                        && pa.PaymentId == l.JournalEntry.SourceDocId && pa.AccountId == l.AccountId));
                else if (tax == "untaxed")
                    q = q.Where(l => !_context.PaymentAllocations.Any(pa =>
                        pa.Kind == AllocationKind.Account && pa.TaxAmount != 0m
                        && pa.PaymentId == l.JournalEntry.SourceDocId && pa.AccountId == l.AccountId));
                else if (decimal.TryParse(tax, out var rate))
                    q = q.Where(l => _context.PaymentAllocations.Any(pa =>
                        pa.Kind == AllocationKind.Account && pa.TaxAmount != 0m && pa.TaxRate == rate
                        && pa.PaymentId == l.JournalEntry.SourceDocId && pa.AccountId == l.AccountId));
            }

            if (!string.IsNullOrWhiteSpace(f.Status))
            {
                var status = f.Status.Trim().ToLowerInvariant();
                if (status is "cheque" or "chequepending")
                    q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Payment
                                  && _context.Payments.Any(p => p.Id == l.JournalEntry.SourceDocId
                                       && p.ChequeStatus == ChequeStatus.Pending));
                else if (status == "reconciled")
                    q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.Payment
                                  && _context.Payments.Any(p => p.Id == l.JournalEntry.SourceDocId
                                       && p.ReconciledDate != null));
                else if (status == "journal")
                    q = q.Where(l => l.JournalEntry.SourceDocType == SourceDocType.ManualJournal);
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

        // ── Totals ────────────────────────────────────────────────────────────────

        private async Task FillExpenseTotalsAsync(int companyId, ReportFilterDto f,
            ReportWindow window, ReportResultDto report)
        {
            var q = BuildExpenseLedgerQuery(companyId, f, window);

            var subtotal = await q.SumAsync(x => (decimal?)x.Debit) ?? 0m;

            // Tax over the whole filtered set: the distinct (payment, account) pairs
            // the filtered lines belong to. Distinct matters — the row grain sums
            // several journal lines per pair, and tax must not be counted twice.
            var pairs = await q
                .Where(x => x.JournalEntry.SourceDocType == SourceDocType.Payment && x.JournalEntry.SourceDocId != null)
                .Select(x => new { PaymentId = x.JournalEntry.SourceDocId!.Value, x.AccountId })
                .Distinct()
                .ToListAsync();

            var totalTax = 0m;
            if (pairs.Count > 0)
            {
                var payIds = pairs.Select(p => p.PaymentId).Distinct().ToList();
                var taxRows = await _context.PaymentAllocations.AsNoTracking()
                    .Where(a => payIds.Contains(a.PaymentId) && a.Kind == AllocationKind.Account
                             && a.AccountId != null && a.TaxAmount != 0m)
                    .GroupBy(a => new { a.PaymentId, AccountId = a.AccountId!.Value })
                    .Select(g => new { g.Key.PaymentId, g.Key.AccountId, Tax = g.Sum(x => x.TaxAmount) })
                    .ToListAsync();
                var wanted = pairs.Select(p => (p.PaymentId, p.AccountId)).ToHashSet();
                totalTax = taxRows.Where(t => wanted.Contains((t.PaymentId, t.AccountId))).Sum(t => t.Tax);
            }

            var transactionCount = await q.Select(x => x.JournalEntry.Id).Distinct().CountAsync();

            report.Totals["subtotal"] = subtotal;
            report.Totals["tax"] = totalTax;
            report.Totals["total"] = subtotal + totalTax;
            report.Totals["transactionCount"] = transactionCount;
            report.TotalLabels["subtotal"] = "Total Expenses";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["total"] = "Total Paid";
            report.TotalLabels["transactionCount"] = "Transactions";
        }

        // ── Grouped summaries ─────────────────────────────────────────────────────

        private async Task<ReportGroupSummaryDto> ExpenseSummaryByAccountAsync(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var rows = await BuildExpenseLedgerQuery(companyId, f, window)
                .GroupBy(x => new { x.AccountId, x.Account.Name })
                .Select(g => new
                {
                    Id = g.Key.AccountId,
                    g.Key.Name,
                    Amount = g.Sum(x => x.Debit),
                    Count = g.Select(x => x.JournalEntry.Id).Distinct().Count(),
                })
                .OrderByDescending(g => g.Amount)
                .ToListAsync();

            return new ReportGroupSummaryDto
            {
                Title = "Expenses by Account",
                DrillFilter = "accountId",
                Rows = rows.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.Id.ToString(),
                    Label = r.Name,
                    Amount = r.Amount,
                    Count = r.Count,
                }).ToList(),
                Total = rows.Sum(r => r.Amount),
            };
        }

        /// <summary>
        /// Expenses by payee. Three passes because a payee is one of three things:
        /// a tagged Client/Supplier (the posting engine writes the party onto every
        /// line of a payment), a free-text "Other" name that lives only on the
        /// payment, or nothing at all (a manual journal or accrued bill has no
        /// payee). Bucketing all the untagged spend into one "unknown" row would
        /// hide exactly the everyday case — the landlord, the courier — this report
        /// exists to show.
        /// </summary>
        private async Task<ReportGroupSummaryDto> ExpenseSummaryByPayeeAsync(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var q = BuildExpenseLedgerQuery(companyId, f, window);

            var tagged = await q
                .Where(x => x.PartyType != null && x.PartyId != null)
                .GroupBy(x => new { Type = x.PartyType!, Id = x.PartyId!.Value })
                .Select(g => new
                {
                    g.Key.Type,
                    g.Key.Id,
                    Amount = g.Sum(x => x.Debit),
                    Count = g.Select(x => x.JournalEntry.Id).Distinct().Count(),
                })
                .ToListAsync();

            var namedOther = await (
                from x in q.Where(x => x.PartyId == null
                                    && x.JournalEntry.SourceDocType == SourceDocType.Payment)
                join p in _context.Payments.AsNoTracking() on x.JournalEntry.SourceDocId equals p.Id
                where p.ContactName != null
                group new { x, p } by p.ContactName! into g
                select new
                {
                    Name = g.Key,
                    Amount = g.Sum(z => z.x.Debit),
                    Count = g.Select(z => z.x.JournalEntry.Id).Distinct().Count(),
                }).ToListAsync();

            // Everything left: journals, accrued bills, payments with no payee named.
            var untaggedTotal = await q.Where(x => x.PartyId == null)
                .SumAsync(x => (decimal?)x.Debit) ?? 0m;
            var untaggedCount = await q.Where(x => x.PartyId == null)
                .Select(x => x.JournalEntry.Id).Distinct().CountAsync();
            var residual = untaggedTotal - namedOther.Sum(n => n.Amount);

            var partyNames = await LoadPartyNamesAsync(companyId,
                tagged.Select(t => ((string?)t.Type, (int?)t.Id)));

            var result = new List<ReportGroupRowDto>();
            result.AddRange(tagged.Select(t => new ReportGroupRowDto
            {
                DrillKey = t.Id.ToString(),
                Label = partyNames.GetValueOrDefault((t.Type, t.Id)) ?? $"{t.Type} #{t.Id}",
                Amount = t.Amount,
                Count = t.Count,
            }));
            result.AddRange(namedOther.Select(n => new ReportGroupRowDto
            {
                DrillKey = null, // free text — nothing to filter the detail report by
                Label = n.Name,
                Amount = n.Amount,
                Count = n.Count,
            }));
            if (residual > 0m)
                result.Add(new ReportGroupRowDto
                {
                    DrillKey = null,
                    Label = "Not attributed to a payee (journals / accrued bills)",
                    Amount = residual,
                    Count = Math.Max(0, untaggedCount - namedOther.Sum(n => n.Count)),
                });

            return new ReportGroupSummaryDto
            {
                Title = "Expenses by Payee",
                DrillFilter = "payeeId",
                Rows = result.OrderByDescending(r => r.Amount).ToList(),
                Total = result.Sum(r => r.Amount),
            };
        }

        // ── "Expenses by X" reports ───────────────────────────────────────────────

        public async Task<ReportResultDto> GetExpenseSummaryAsync(int companyId,
            ReportFilterDto filter, string groupBy)
        {
            var window = ResolveWindow(filter);
            var glOn = await _posting.IsEnabledAsync(companyId);
            var key = (groupBy ?? "account").Trim().ToLowerInvariant();

            var report = await NewReportAsync(companyId, SummaryTitle(key), window, filter, glOn);
            report.Columns = new List<ReportColumnDto>
            {
                Col("label", SummaryDimensionLabel(key)),
                Col("amount", "Amount", "money", totalled: true),
                Col("tax", "Tax", "money", totalled: true),
                Col("count", "Transactions", "int"),
            };

            if (!glOn)
            {
                report.Notice = "GL posting is off for this company, so this summary covers "
                              + "payment-recorded expenses only.";
            }

            var summary = key switch
            {
                "payee" => await ExpenseSummaryByPayeeAsync(companyId, filter, window),
                "group" or "category" => await ExpenseSummaryByGroupAsync(companyId, filter, window),
                "date" => await ExpenseSummaryByDateAsync(companyId, filter, window, monthly: false),
                "month" => await ExpenseSummaryByDateAsync(companyId, filter, window, monthly: true),
                "paymentaccount" => await ExpenseSummaryByPaymentAccountAsync(companyId, filter, window),
                "tax" => await ExpenseSummaryByTaxAsync(companyId, filter, window),
                _ => await ExpenseSummaryByAccountAsync(companyId, filter, window),
            };

            report.Rows = summary.Rows.Cast<object>().ToList();
            report.TotalCount = summary.Rows.Count;
            report.Page = 1;
            report.PageSize = summary.Rows.Count;
            report.Totals["amount"] = summary.Total;
            report.Totals["tax"] = summary.Rows.Sum(r => r.Tax);
            report.Totals["transactionCount"] = summary.Rows.Sum(r => r.Count);
            report.TotalLabels["amount"] = "Total Expenses";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["transactionCount"] = "Transactions";
            return report;
        }

        private static string SummaryTitle(string key) => key switch
        {
            "payee" => "Expenses by Payee",
            "group" or "category" => "Expenses by Category",
            "date" => "Expenses by Date",
            "month" => "Monthly Expenses",
            "paymentaccount" => "Expenses by Payment Account",
            "tax" => "Expenses by Tax",
            _ => "Expenses by Account",
        };

        private static string SummaryDimensionLabel(string key) => key switch
        {
            "payee" => "Payee",
            // Named for what it actually is: this product has no separate expense
            // category — the grouping IS the account's Chart-of-Accounts group.
            "group" or "category" => "Category (Account Group)",
            "date" => "Date",
            "month" => "Month",
            "paymentaccount" => "Payment Account",
            "tax" => "Tax",
            _ => "Expense Account",
        };

        private async Task<ReportGroupSummaryDto> ExpenseSummaryByGroupAsync(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var rows = await (
                from x in BuildExpenseLedgerQuery(companyId, f, window)
                join g in _context.AccountGroups.AsNoTracking() on x.Account.AccountGroupId equals g.Id
                group new { x, g } by new { g.Id, g.Name } into grp
                select new
                {
                    grp.Key.Id,
                    grp.Key.Name,
                    Amount = grp.Sum(z => z.x.Debit),
                    Count = grp.Select(z => z.x.JournalEntry.Id).Distinct().Count(),
                }).OrderByDescending(r => r.Amount).ToListAsync();

            return new ReportGroupSummaryDto
            {
                Title = "Expenses by Category",
                DrillFilter = "accountGroupId",
                Rows = rows.Select(r => new ReportGroupRowDto
                { DrillKey = r.Id.ToString(), Label = r.Name, Amount = r.Amount, Count = r.Count }).ToList(),
                Total = rows.Sum(r => r.Amount),
            };
        }

        private async Task<ReportGroupSummaryDto> ExpenseSummaryByDateAsync(
            int companyId, ReportFilterDto f, ReportWindow window, bool monthly)
        {
            var q = BuildExpenseLedgerQuery(companyId, f, window);

            var rows = monthly
                ? (await q.GroupBy(x => new { x.JournalEntry.Date.Year, x.JournalEntry.Date.Month })
                    .Select(g => new
                    {
                        Sort = new DateTime(g.Key.Year, g.Key.Month, 1),
                        Amount = g.Sum(x => x.Debit),
                        Count = g.Select(x => x.JournalEntry.Id).Distinct().Count(),
                    }).ToListAsync())
                    .Select(g => new { g.Sort, Label = g.Sort.ToString("MMM yyyy"), g.Amount, g.Count })
                    .ToList()
                : (await q.GroupBy(x => x.JournalEntry.Date)
                    .Select(g => new
                    {
                        Sort = g.Key,
                        Amount = g.Sum(x => x.Debit),
                        Count = g.Select(x => x.JournalEntry.Id).Distinct().Count(),
                    }).ToListAsync())
                    .Select(g => new { g.Sort, Label = g.Sort.ToString("d MMM yyyy"), g.Amount, g.Count })
                    .ToList();

            // Chronological, not by size — a time series read out of order is useless.
            rows = rows.OrderBy(r => r.Sort).ToList();

            return new ReportGroupSummaryDto
            {
                Title = monthly ? "Monthly Expenses" : "Expenses by Date",
                DrillFilter = null,
                Rows = rows.Select(r => new ReportGroupRowDto
                { DrillKey = r.Sort.ToString("yyyy-MM-dd"), Label = r.Label, Amount = r.Amount, Count = r.Count }).ToList(),
                Total = rows.Sum(r => r.Amount),
            };
        }

        private async Task<ReportGroupSummaryDto> ExpenseSummaryByPaymentAccountAsync(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var rows = await (
                from x in BuildExpenseLedgerQuery(companyId, f, window)
                    .Where(x => x.JournalEntry.SourceDocType == SourceDocType.Payment)
                join p in _context.Payments.AsNoTracking() on x.JournalEntry.SourceDocId equals p.Id
                group new { x, p } by new { p.BankAccountId, p.BankAccountName } into g
                select new
                {
                    g.Key.BankAccountId,
                    g.Key.BankAccountName,
                    Amount = g.Sum(z => z.x.Debit),
                    Count = g.Select(z => z.x.JournalEntry.Id).Distinct().Count(),
                }).ToListAsync();

            var accountIds = rows.Where(r => r.BankAccountId.HasValue)
                .Select(r => r.BankAccountId!.Value).Distinct().ToList();
            var names = accountIds.Count == 0
                ? new Dictionary<int, string>()
                : await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && accountIds.Contains(a.Id))
                    .ToDictionaryAsync(a => a.Id, a => a.Name);

            return new ReportGroupSummaryDto
            {
                Title = "Expenses by Payment Account",
                DrillFilter = "paymentAccountId",
                Rows = rows.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.BankAccountId?.ToString(),
                    Label = r.BankAccountId.HasValue
                        ? names.GetValueOrDefault(r.BankAccountId.Value) ?? r.BankAccountName ?? "—"
                        : r.BankAccountName ?? "Not recorded",
                    Amount = r.Amount,
                    Count = r.Count,
                }).OrderByDescending(r => r.Amount).ToList(),
                Total = rows.Sum(r => r.Amount),
            };
        }

        /// <summary>
        /// Expenses by tax rate. Only payment-recorded expenses carry a per-line rate
        /// (<c>PaymentAllocation.TaxRate</c>); everything else groups under "No tax
        /// recorded" rather than being assigned a rate it never had.
        /// </summary>
        private async Task<ReportGroupSummaryDto> ExpenseSummaryByTaxAsync(
            int companyId, ReportFilterDto f, ReportWindow window)
        {
            var q = BuildExpenseLedgerQuery(companyId, f, window);

            var taxed = await (
                from x in q.Where(x => x.JournalEntry.SourceDocType == SourceDocType.Payment)
                join a in _context.PaymentAllocations.AsNoTracking()
                    on new { P = x.JournalEntry.SourceDocId, A = (int?)x.AccountId }
                    equals new { P = (int?)a.PaymentId, A = a.AccountId }
                where a.Kind == AllocationKind.Account && a.TaxAmount != 0m
                group new { x, a } by a.TaxRate into g
                select new
                {
                    Rate = g.Key,
                    Amount = g.Sum(z => z.x.Debit),
                    Tax = g.Sum(z => z.a.TaxAmount),
                    Count = g.Select(z => z.x.JournalEntry.Id).Distinct().Count(),
                }).ToListAsync();

            var totalAll = await q.SumAsync(x => (decimal?)x.Debit) ?? 0m;
            var untaxed = totalAll - taxed.Sum(t => t.Amount);

            var rows = taxed.Select(t => new ReportGroupRowDto
            {
                DrillKey = t.Rate?.ToString(),
                Label = t.Rate.HasValue ? $"{t.Rate.Value:0.##}%" : "Tax recorded, rate not set",
                Amount = t.Amount,
                Tax = t.Tax,
                Count = t.Count,
            }).OrderByDescending(r => r.Amount).ToList();

            if (untaxed > 0m)
                rows.Add(new ReportGroupRowDto { DrillKey = "untaxed", Label = "No tax recorded", Amount = untaxed });

            return new ReportGroupSummaryDto
            {
                Title = "Expenses by Tax",
                DrillFilter = "tax",
                Rows = rows,
                Total = rows.Sum(r => r.Amount),
            };
        }

        // ── GL-off fallback ───────────────────────────────────────────────────────

        /// <summary>
        /// Expenses for a company that doesn't post to the ledger: read the payment
        /// subledger directly. Narrower than the ledger path by construction (it
        /// cannot see manual journals or accrued purchase bills, because with GL off
        /// those never become an expense anywhere), which is why the caller reports
        /// <see cref="ReportResultDto.LedgerSourced"/> = false.
        /// </summary>
        private async Task FillExpensesFromSubledgerAsync(int companyId, ReportFilterDto f,
            ReportWindow window, ReportResultDto report, bool includeGroupSummaries, bool forExport)
        {
            var q = from a in _context.PaymentAllocations.AsNoTracking()
                    join p in _context.Payments.AsNoTracking() on a.PaymentId equals p.Id
                    join acc in _context.Accounts.AsNoTracking() on a.AccountId equals acc.Id
                    where p.CompanyId == companyId && !p.IsCancelled
                          && p.Direction == PaymentDirection.Payment
                          && a.Kind == AllocationKind.Account
                          && acc.AccountType == AccountType.Expense
                    select new { Alloc = a, Payment = p, Account = acc };

            if (f.AllowedDivisionIds != null)
            {
                var allowedDivisions = f.AllowedDivisionIds;
                q = q.Where(x => x.Payment.DivisionId == null
                              || allowedDivisions.Contains(x.Payment.DivisionId.Value));
            }
            if (window.From.HasValue) q = q.Where(x => x.Payment.Date >= window.From!.Value);
            if (window.To.HasValue) q = q.Where(x => x.Payment.Date <= window.To!.Value);
            if (f.DivisionId.HasValue) q = q.Where(x => x.Payment.DivisionId == f.DivisionId!.Value);
            if (f.AccountId.HasValue) q = q.Where(x => x.Account.Id == f.AccountId!.Value);
            if (f.AccountGroupId.HasValue) q = q.Where(x => x.Account.AccountGroupId == f.AccountGroupId!.Value);
            if (f.PaymentAccountId.HasValue) q = q.Where(x => x.Payment.BankAccountId == f.PaymentAccountId!.Value);
            if (f.PayeeType is "Client" or "Supplier" or "Other")
                q = q.Where(x => x.Payment.ContactType == f.PayeeType);
            if (f.PayeeId.HasValue) q = q.Where(x => x.Payment.ContactId == f.PayeeId!.Value);
            if (!string.IsNullOrWhiteSpace(f.Search))
            {
                var s = f.Search.Trim();
                q = q.Where(x => EF.Functions.Like(x.Account.Name, $"%{s}%")
                              || (x.Payment.Description != null
                                  && EF.Functions.Like(x.Payment.Description, $"%{s}%")));
            }

            report.TotalCount = await q.CountAsync();
            var (page, size) = ResolvePaging(f, forExport);
            report.Page = page;
            report.PageSize = size;

            var rows = await q
                .OrderByDescending(x => x.Payment.Date).ThenByDescending(x => x.Payment.Number)
                .Skip((page - 1) * size).Take(size)
                .Select(x => new
                {
                    x.Payment.Id,
                    x.Payment.Number,
                    x.Payment.Date,
                    x.Payment.ContactType,
                    x.Payment.ContactId,
                    x.Payment.ContactName,
                    x.Payment.BankAccountId,
                    x.Payment.BankAccountName,
                    x.Payment.ChequeNumber,
                    x.Payment.Description,
                    x.Payment.DivisionId,
                    AccountId = x.Account.Id,
                    AccountName = x.Account.Name,
                    x.Account.AccountGroupId,
                    x.Alloc.Amount,
                    x.Alloc.TaxAmount,
                })
                .ToListAsync();

            var partyNames = await LoadPartyNamesAsync(companyId,
                rows.Select(r => ((string?)r.ContactType, r.ContactId)));
            var groupIds = rows.Select(r => r.AccountGroupId).Distinct().ToList();
            var groupNames = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId && groupIds.Contains(g.Id))
                .ToDictionaryAsync(g => g.Id, g => g.Name);

            report.Rows = rows.Select(r => (object)new ExpenseReportRowDto
            {
                Date = r.Date,
                DocumentNo = PaymentRef(PaymentDirection.Payment, r.Number),
                SourceType = "Payment",
                SourceId = r.Id,
                Payee = ResolvePartyName(partyNames, r.ContactType, r.ContactId, r.ContactName),
                PayeeType = r.ContactType,
                PayeeId = r.ContactId,
                Description = r.Description,
                ExpenseAccountId = r.AccountId,
                ExpenseAccount = r.AccountName,
                ExpenseGroupId = r.AccountGroupId,
                ExpenseGroup = groupNames.GetValueOrDefault(r.AccountGroupId),
                PaymentAccountId = r.BankAccountId,
                PaymentAccount = r.BankAccountName,
                // Amount is gross cash; the expense recognised is gross − tax.
                Subtotal = r.Amount - r.TaxAmount,
                Tax = r.TaxAmount,
                Total = r.Amount,
                Reference = r.ChequeNumber,
            }).ToList();

            var gross = await q.SumAsync(x => (decimal?)x.Alloc.Amount) ?? 0m;
            var tax = await q.SumAsync(x => (decimal?)x.Alloc.TaxAmount) ?? 0m;
            report.Totals["subtotal"] = gross - tax;
            report.Totals["tax"] = tax;
            report.Totals["total"] = gross;
            report.Totals["transactionCount"] = await q.Select(x => x.Payment.Id).Distinct().CountAsync();
            report.TotalLabels["subtotal"] = "Total Expenses";
            report.TotalLabels["tax"] = "Total Tax";
            report.TotalLabels["total"] = "Total Paid";
            report.TotalLabels["transactionCount"] = "Transactions";

            if (!includeGroupSummaries) return;

            var byAccount = await q
                .GroupBy(x => new { x.Account.Id, x.Account.Name })
                .Select(g => new
                {
                    g.Key.Id, g.Key.Name,
                    Amount = g.Sum(x => x.Alloc.Amount - x.Alloc.TaxAmount),
                    Tax = g.Sum(x => x.Alloc.TaxAmount),
                    Count = g.Select(x => x.Payment.Id).Distinct().Count(),
                })
                .OrderByDescending(g => g.Amount).ToListAsync();

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = "Expenses by Account",
                DrillFilter = "accountId",
                Rows = byAccount.Select(r => new ReportGroupRowDto
                { DrillKey = r.Id.ToString(), Label = r.Name, Amount = r.Amount, Tax = r.Tax, Count = r.Count }).ToList(),
                Total = byAccount.Sum(r => r.Amount),
            });

            var byPayee = await q
                .GroupBy(x => new { x.Payment.ContactType, x.Payment.ContactId, x.Payment.ContactName })
                .Select(g => new
                {
                    g.Key.ContactType, g.Key.ContactId, g.Key.ContactName,
                    Amount = g.Sum(x => x.Alloc.Amount - x.Alloc.TaxAmount),
                    Tax = g.Sum(x => x.Alloc.TaxAmount),
                    Count = g.Select(x => x.Payment.Id).Distinct().Count(),
                }).ToListAsync();

            var payeeNames = await LoadPartyNamesAsync(companyId,
                byPayee.Select(p => ((string?)p.ContactType, p.ContactId)));

            report.GroupSummaries.Add(new ReportGroupSummaryDto
            {
                Title = "Expenses by Payee",
                DrillFilter = "payeeId",
                Rows = byPayee.Select(r => new ReportGroupRowDto
                {
                    DrillKey = r.ContactId?.ToString(),
                    Label = ResolvePartyName(payeeNames, r.ContactType, r.ContactId, r.ContactName)
                            ?? "Not recorded",
                    Amount = r.Amount, Tax = r.Tax, Count = r.Count,
                }).OrderByDescending(r => r.Amount).ToList(),
                Total = byPayee.Sum(r => r.Amount),
            });
        }

        // ── Row helpers ───────────────────────────────────────────────────────────

        private sealed class ExpensePaymentInfo
        {
            public int Id { get; set; }
            public int Number { get; set; }
            public PaymentDirection Direction { get; set; }
            public string? ContactType { get; set; }
            public int? ContactId { get; set; }
            public string? ContactName { get; set; }
            public int? BankAccountId { get; set; }
            public string? BankAccountName { get; set; }
            public string? ChequeNumber { get; set; }
            public string? Description { get; set; }
            public string? Method { get; set; }
        }

        private sealed class ExpenseBillInfo
        {
            public int Id { get; set; }
            public int Number { get; set; }
            public string? SupplierBillNumber { get; set; }
            public int SupplierId { get; set; }
            public string SupplierName { get; set; } = "";
        }

        /// <summary>
        /// The document number to show. There is no Expense document in this product,
        /// so an expense is always identified by whatever produced it — the payment
        /// voucher, the purchase bill, or the journal entry.
        /// </summary>
        private static string DescribeSource(SourceDocType type, int entryNo,
            ExpensePaymentInfo? pay, ExpenseBillInfo? bill) => type switch
        {
            SourceDocType.Payment when pay != null => PaymentRef(pay.Direction, pay.Number),
            SourceDocType.PurchaseBill when bill != null => $"BILL-{bill.Number}",
            SourceDocType.ManualJournal => $"JE-{entryNo}",
            SourceDocType.PurchaseDebitNote => $"PDN-{entryNo}",
            SourceDocType.AccountTransfer => $"TRF-{entryNo}",
            SourceDocType.Invoice => $"INV-{entryNo}",
            _ => $"JE-{entryNo}",
        };

        private static string? FirstNonEmpty(params string?[] values) =>
            values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));

        private static object? ExpenseSortValue(ExpenseReportRowDto r, string key) => key switch
        {
            "date" => r.Date,
            "documentNo" => r.DocumentNo,
            "payee" => r.Payee,
            "payeeType" => r.PayeeType,
            "description" => r.Description,
            "expenseAccount" => r.ExpenseAccount,
            "paymentAccount" => r.PaymentAccount,
            "subtotal" => r.Subtotal,
            "tax" => r.Tax,
            "total" => r.Total,
            "reference" => r.Reference,
            _ => null,
        };
    }
}
