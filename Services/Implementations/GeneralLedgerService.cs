using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class GeneralLedgerService : IGeneralLedgerService
    {
        private readonly AppDbContext _context;
        private readonly IPostingService _posting;
        private readonly ICoaPresetSeeder _seeder;
        private readonly IAuditLogService _auditLog;
        private readonly ILogger<GeneralLedgerService> _logger;

        public GeneralLedgerService(AppDbContext context, IPostingService posting,
            ICoaPresetSeeder seeder, IAuditLogService auditLog, ILogger<GeneralLedgerService> logger)
        {
            _context = context;
            _posting = posting;
            _seeder = seeder;
            _auditLog = auditLog;
            _logger = logger;
        }

        // ── Status ─────────────────────────────────────────────────────────────

        public async Task<GlStatusDto> GetStatusAsync(int companyId)
        {
            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.GlPostingEnabled, c.GlLockDate })
                .FirstOrDefaultAsync()
                ?? throw new InvalidOperationException("Company not found.");

            var accountCount = await _context.Accounts.CountAsync(a => a.CompanyId == companyId);
            var entryCount = await _context.JournalEntries.CountAsync(e => e.CompanyId == companyId);
            var totals = await _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId)
                .GroupBy(_ => 1)
                .Select(g => new { Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .FirstOrDefaultAsync();

            return new GlStatusDto
            {
                Enabled = company.GlPostingEnabled,
                LockDate = company.GlLockDate,
                HasCoa = accountCount > 0,
                AccountCount = accountCount,
                EntryCount = entryCount,
                TotalDebit = totals?.Dr ?? 0m,
                TotalCredit = totals?.Cr ?? 0m,
            };
        }

        // ── Enable + backfill ──────────────────────────────────────────────────

        public async Task<GlEnableResultDto> EnableAsync(int companyId)
        {
            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException("Company not found.");

            var seeded = 0;
            if (!await _context.Accounts.AnyAsync(a => a.CompanyId == companyId))
                seeded = await _seeder.SeedWholesaleAsync(companyId);

            var wasEnabled = company.GlPostingEnabled;
            if (!company.GlPostingEnabled)
            {
                company.GlPostingEnabled = true;
                await _context.SaveChangesAsync();
            }

            GlEnableResultDto result;
            try
            {
                result = await RebuildAsync(companyId);
            }
            catch (Exception ex)
            {
                // Don't leave the company half-enabled (flag on, backfill aborted)
                // and — unlike before — leave a trace: the enable endpoint only
                // audit-logged on success, so a failed backfill vanished from the
                // audit log. Revert the flag (if we set it) and record the failure.
                if (!wasEnabled)
                {
                    company.GlPostingEnabled = false;
                    try { await _context.SaveChangesAsync(); } catch { /* best-effort revert */ }
                }
                try
                {
                    await _auditLog.LogAsync(new AuditLog
                    {
                        Level = "Error",
                        HttpMethod = "POST",
                        RequestPath = $"/accounting/gl/company/{companyId}/enable",
                        StatusCode = 400,
                        ExceptionType = "GL_ENABLE_FAILED_V1",
                        Message = $"GL enable/backfill failed for company {companyId}: {ex.Message}",
                    });
                }
                catch { /* audit must never mask the original failure */ }
                throw;
            }
            result.SeededAccounts = seeded;

            try
            {
                await _auditLog.LogAsync(new AuditLog
                {
                    Level = "Info",
                    HttpMethod = "POST",
                    RequestPath = $"/accounting/gl/company/{companyId}/enable",
                    StatusCode = 200,
                    ExceptionType = "GL_ENABLE_V1",
                    Message = $"GL posting enabled for company {companyId}: seeded {seeded} accounts, " +
                              $"posted {result.PostedInvoices} invoices / {result.PostedBills} bills / " +
                              $"{result.PostedPayments} payments / {result.PostedTransfers} transfers.",
                });
            }
            catch { /* audit must never break the operation */ }

            return result;
        }

        public async Task<GlEnableResultDto> RebuildAsync(int companyId)
        {
            if (!await _posting.IsEnabledAsync(companyId))
                throw new InvalidOperationException("Enable GL posting for this company first.");

            // Wipe system-posted entries; manual journals survive a rebuild.
            var removed = await _context.JournalEntries
                .Where(e => e.CompanyId == companyId && e.SourceDocType != SourceDocType.ManualJournal)
                .ExecuteDeleteAsync();

            var result = new GlEnableResultDto { Enabled = true, RemovedEntries = removed };

            // Invoices (incl. credit/debit notes). Demo/cancelled/zero rows are
            // excluded here AND guarded inside PostInvoiceAsync.
            var invoiceIds = await _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled && i.GrandTotal != 0)
                .OrderBy(i => i.Date).ThenBy(i => i.Id)
                .Select(i => i.Id).ToListAsync();
            foreach (var chunk in Chunk(invoiceIds, 200))
            {
                var rows = await _context.Invoices.AsNoTracking()
                    .Where(i => chunk.Contains(i.Id)).ToListAsync();
                foreach (var inv in rows) { await _posting.PostInvoiceAsync(inv); result.PostedInvoices++; }
                _context.ChangeTracker.Clear();
            }

            var billIds = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && b.GrandTotal != 0)
                .OrderBy(b => b.Date).ThenBy(b => b.Id)
                .Select(b => b.Id).ToListAsync();
            foreach (var chunk in Chunk(billIds, 200))
            {
                var rows = await _context.PurchaseBills.AsNoTracking()
                    .Where(b => chunk.Contains(b.Id)).ToListAsync();
                foreach (var bill in rows) { await _posting.PostPurchaseBillAsync(bill); result.PostedBills++; }
                _context.ChangeTracker.Clear();
            }

            var paymentIds = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled && p.Amount != 0)
                .OrderBy(p => p.Date).ThenBy(p => p.Id)
                .Select(p => p.Id).ToListAsync();
            foreach (var chunk in Chunk(paymentIds, 200))
            {
                var rows = await _context.Payments.AsNoTracking()
                    .Include(p => p.Allocations)
                    .Where(p => chunk.Contains(p.Id)).ToListAsync();
                foreach (var pay in rows) { await _posting.PostPaymentAsync(pay); result.PostedPayments++; }
                _context.ChangeTracker.Clear();
            }

            var transfers = await _context.AccountTransfers.AsNoTracking()
                .Where(t => t.CompanyId == companyId)
                .OrderBy(t => t.Date).ThenBy(t => t.Id).ToListAsync();
            foreach (var t in transfers) { await _posting.PostTransferAsync(t); result.PostedTransfers++; }
            _context.ChangeTracker.Clear();

            _logger.LogInformation(
                "GL rebuild for company {CompanyId}: {Invoices} invoices, {Bills} bills, {Payments} payments, {Transfers} transfers ({Removed} old entries removed).",
                companyId, result.PostedInvoices, result.PostedBills, result.PostedPayments, result.PostedTransfers, removed);
            return result;
        }

        public async Task SetLockDateAsync(int companyId, DateTime? lockDate)
        {
            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException("Company not found.");
            company.GlLockDate = lockDate?.Date;
            await _context.SaveChangesAsync();
        }

        private static IEnumerable<List<int>> Chunk(List<int> ids, int size)
        {
            for (var i = 0; i < ids.Count; i += size)
                yield return ids.GetRange(i, Math.Min(size, ids.Count - i));
        }

        // ── Balances ───────────────────────────────────────────────────────────

        public async Task<Dictionary<int, decimal>> GetAccountBalancesAsync(int companyId, DateTime? asAt = null)
        {
            var opening = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId)
                .Select(a => new { a.Id, Signed = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance })
                .ToListAsync();

            var movement = await _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && (asAt == null || l.JournalEntry.Date <= asAt.Value.Date))
                .GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                .ToDictionaryAsync(x => x.AccountId, x => x.Net);

            return opening.ToDictionary(
                a => a.Id,
                a => a.Signed + movement.GetValueOrDefault(a.Id));
        }

        // ── Account ledger drill-down ──────────────────────────────────────────

        public async Task<AccountLedgerDto?> GetAccountLedgerAsync(int accountId, DateTime? from, DateTime? to, int page, int pageSize)
        {
            var account = await _context.Accounts.AsNoTracking()
                .FirstOrDefaultAsync(a => a.Id == accountId);
            if (account == null) return null;

            page = PaginationHelper.ClampPage(page);
            pageSize = PaginationHelper.Clamp(pageSize, 50, PaginationHelper.AuditMax);

            var signedOpening = account.OpeningBalanceIsDebit ? account.OpeningBalance : -account.OpeningBalance;

            // Movement before the window start rolls into the opening figure.
            var preWindow = from.HasValue
                ? await _context.JournalLines.AsNoTracking()
                    .Where(l => l.AccountId == accountId && l.JournalEntry.Date < from.Value.Date)
                    .SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;
            var openingBalance = signedOpening + preWindow;

            var query = _context.JournalLines.AsNoTracking()
                .Where(l => l.AccountId == accountId
                         && (from == null || l.JournalEntry.Date >= from.Value.Date)
                         && (to == null || l.JournalEntry.Date <= to.Value.Date))
                .OrderBy(l => l.JournalEntry.Date)
                .ThenBy(l => l.JournalEntryId)
                .ThenBy(l => l.Id);

            var totalCount = await query.CountAsync();
            var offset = (page - 1) * pageSize;

            // Balance carried into this page = opening + Σ(net) of the rows
            // BEFORE the page (same ordering, TOP offset).
            var beforePage = offset > 0
                ? await query.Take(offset).SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var rows = await query.Skip(offset).Take(pageSize)
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
                })
                .ToListAsync();

            var running = openingBalance + beforePage;
            var items = new List<AccountLedgerRowDto>(rows.Count);
            foreach (var r in rows)
            {
                running += r.Debit - r.Credit;
                items.Add(new AccountLedgerRowDto
                {
                    JournalEntryId = r.JournalEntryId,
                    EntryNo = r.EntryNo,
                    Date = r.Date,
                    SourceDocType = r.SourceDocType.ToString(),
                    SourceDocId = r.SourceDocId,
                    Narration = r.Narration,
                    Description = r.Description,
                    Debit = r.Debit,
                    Credit = r.Credit,
                    RunningBalance = running,
                });
            }

            var windowNet = await query.SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m;

            return new AccountLedgerDto
            {
                AccountId = account.Id,
                AccountName = account.Name,
                Code = account.Code,
                AccountType = account.AccountType.ToString(),
                OpeningBalance = openingBalance,
                ClosingBalance = openingBalance + windowNet,
                Items = items,
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
            };
        }

        // ── Trial balance ──────────────────────────────────────────────────────

        public async Task<TrialBalanceDto> GetTrialBalanceAsync(int companyId, DateTime? from, DateTime? to)
        {
            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId)
                .OrderBy(a => a.Code == null).ThenBy(a => a.Code).ThenBy(a => a.Name)
                .ToListAsync();

            var preWindow = from.HasValue
                ? await _context.JournalLines.AsNoTracking()
                    .Where(l => l.JournalEntry.CompanyId == companyId && l.JournalEntry.Date < from.Value.Date)
                    .GroupBy(l => l.AccountId)
                    .Select(g => new { AccountId = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                    .ToDictionaryAsync(x => x.AccountId, x => x.Net)
                : new Dictionary<int, decimal>();

            var window = await _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && (from == null || l.JournalEntry.Date >= from.Value.Date)
                         && (to == null || l.JournalEntry.Date <= to.Value.Date))
                .GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, Dr = g.Sum(x => x.Debit), Cr = g.Sum(x => x.Credit) })
                .ToDictionaryAsync(x => x.AccountId, x => new { x.Dr, x.Cr });

            var dto = new TrialBalanceDto { From = from, To = to };
            foreach (var a in accounts)
            {
                var signedOpening = (a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance)
                                  + preWindow.GetValueOrDefault(a.Id);
                var mv = window.GetValueOrDefault(a.Id);
                var dr = mv?.Dr ?? 0m;
                var cr = mv?.Cr ?? 0m;
                if (signedOpening == 0m && dr == 0m && cr == 0m) continue; // zero rows add noise

                dto.Rows.Add(new TrialBalanceRowDto
                {
                    AccountId = a.Id,
                    Code = a.Code,
                    Name = a.Name,
                    AccountType = a.AccountType.ToString(),
                    Opening = signedOpening,
                    Debit = dr,
                    Credit = cr,
                    Closing = signedOpening + dr - cr,
                });
            }

            dto.TotalOpening = dto.Rows.Sum(r => r.Opening);
            dto.TotalDebit = dto.Rows.Sum(r => r.Debit);
            dto.TotalCredit = dto.Rows.Sum(r => r.Credit);
            dto.TotalClosing = dto.Rows.Sum(r => r.Closing);
            return dto;
        }

        // ── AR / AP aging (subledger — available with or without the GL) ──────

        public Task<AgedReportDto> GetAgedReceivablesAsync(int companyId) =>
            BuildAgingAsync(companyId, receivables: true);

        public Task<AgedReportDto> GetAgedPayablesAsync(int companyId) =>
            BuildAgingAsync(companyId, receivables: false);

        private async Task<AgedReportDto> BuildAgingAsync(int companyId, bool receivables)
        {
            var today = PakistanClock.Today;
            var report = new AgedReportDto { Kind = receivables ? "Receivables" : "Payables", AsOf = today };

            List<(int PartyId, string Name, DateTime Anchor, decimal Due)> open;
            if (receivables)
            {
                open = (await _context.Invoices.AsNoTracking()
                    .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                             && i.DocumentType != 9 && i.DocumentType != 10
                             && i.GrandTotal > i.AmountPaid)
                    .Select(i => new { i.ClientId, ClientName = i.Client!.Name, i.Date, i.DueDate, Due = i.GrandTotal - i.AmountPaid })
                    .ToListAsync())
                    .Select(x => (x.ClientId, x.ClientName, (x.DueDate ?? x.Date).Date, x.Due)).ToList();
            }
            else
            {
                open = (await _context.PurchaseBills.AsNoTracking()
                    .Where(b => b.CompanyId == companyId && b.GrandTotal > b.AmountPaid)
                    .Select(b => new { b.SupplierId, SupplierName = b.Supplier!.Name, b.Date, b.DueDate, Due = b.GrandTotal - b.AmountPaid })
                    .ToListAsync())
                    .Select(x => (x.SupplierId, x.SupplierName, (x.DueDate ?? x.Date).Date, x.Due)).ToList();
            }

            foreach (var grp in open.GroupBy(x => new { x.PartyId, x.Name }).OrderByDescending(g => g.Sum(x => x.Due)))
            {
                var row = new AgedPartyRowDto { PartyId = grp.Key.PartyId, Name = grp.Key.Name, OpenDocuments = grp.Count() };
                foreach (var (_, _, anchor, due) in grp)
                {
                    var days = (today - anchor).Days;
                    row.Total += due;
                    if (days <= 0) row.Current += due;
                    else if (days <= 30) row.Days1To30 += due;
                    else if (days <= 60) row.Days31To60 += due;
                    else if (days <= 90) row.Days61To90 += due;
                    else row.Over90 += due;
                }
                report.Rows.Add(row);
            }

            report.Total = report.Rows.Sum(r => r.Total);
            report.Current = report.Rows.Sum(r => r.Current);
            report.Days1To30 = report.Rows.Sum(r => r.Days1To30);
            report.Days31To60 = report.Rows.Sum(r => r.Days31To60);
            report.Days61To90 = report.Rows.Sum(r => r.Days61To90);
            report.Over90 = report.Rows.Sum(r => r.Over90);
            return report;
        }

        // ── Accounting summary (dashboard) ─────────────────────────────────────

        public async Task<AccountingSummaryDto> GetSummaryAsync(int companyId, DateTime? from, DateTime? to)
        {
            var today = PakistanClock.Today;
            var periodFrom = (from ?? new DateTime(today.Year, today.Month, 1)).Date;
            var periodTo = (to ?? today).Date;

            var glEnabled = await _posting.IsEnabledAsync(companyId);
            var summary = new AccountingSummaryDto { From = periodFrom, To = periodTo, GlEnabled = glEnabled };

            // Cash & bank (GL balances, all-time as of today).
            if (glEnabled)
            {
                var balances = await GetAccountBalancesAsync(companyId);
                var groups = await _context.AccountGroups.AsNoTracking()
                    .Where(g => g.CompanyId == companyId)
                    .Select(g => new { g.Id, g.Name }).ToListAsync();
                var bankGroupIds = groups
                    .Where(g => (g.Name ?? "").Contains("bank", StringComparison.OrdinalIgnoreCase)
                             || (g.Name ?? "").Contains("cash", StringComparison.OrdinalIgnoreCase))
                    .Select(g => g.Id).ToHashSet();

                var cashAccounts = await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId && a.IsActive && a.AccountType == AccountType.Asset)
                    .ToListAsync();
                foreach (var a in cashAccounts.Where(a =>
                             a.ControlType == ControlType.BankCash || bankGroupIds.Contains(a.AccountGroupId)))
                {
                    var bal = balances.GetValueOrDefault(a.Id);
                    summary.CashAccounts.Add(new CashAccountBalanceDto
                    { AccountId = a.Id, Name = a.Name, Code = a.Code, Balance = bal });
                }
                summary.CashAccounts = summary.CashAccounts.OrderByDescending(c => c.Balance).ToList();
                summary.CashAndBankTotal = summary.CashAccounts.Sum(c => c.Balance);

                // Profitability for the period from the GL (income is
                // credit-natural, so flip the sign for display).
                var plByAccount = await _context.JournalLines.AsNoTracking()
                    .Where(l => l.JournalEntry.CompanyId == companyId
                             && l.JournalEntry.Date >= periodFrom && l.JournalEntry.Date <= periodTo)
                    .GroupBy(l => l.Account.AccountType)
                    .Select(g => new { Type = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                    .ToListAsync();
                summary.Income = -plByAccount.Where(x => x.Type == AccountType.Income).Sum(x => x.Net);
                summary.Expenses = plByAccount.Where(x => x.Type == AccountType.Expense).Sum(x => x.Net);
                summary.NetProfit = summary.Income - summary.Expenses;
            }

            // Working capital buckets (subledger).
            var ar = await GetAgedReceivablesAsync(companyId);
            summary.Receivables = new AgingBucketsDto
            {
                Total = ar.Total, Current = ar.Current, Days1To30 = ar.Days1To30,
                Days31To60 = ar.Days31To60, Days61To90 = ar.Days61To90, Over90 = ar.Over90,
            };
            var ap = await GetAgedPayablesAsync(companyId);
            summary.Payables = new AgingBucketsDto
            {
                Total = ap.Total, Current = ap.Current, Days1To30 = ap.Days1To30,
                Days31To60 = ap.Days31To60, Days61To90 = ap.Days61To90, Over90 = ap.Over90,
            };

            // Money movement in the period.
            var periodPayments = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled
                         && p.Date >= periodFrom && p.Date <= periodTo)
                .GroupBy(p => p.Direction)
                .Select(g => new { Direction = g.Key, Count = g.Count(), Total = g.Sum(x => x.Amount) })
                .ToListAsync();
            var rc = periodPayments.FirstOrDefault(x => x.Direction == PaymentDirection.Receipt);
            var pm = periodPayments.FirstOrDefault(x => x.Direction == PaymentDirection.Payment);
            summary.ReceiptCount = rc?.Count ?? 0;
            summary.ReceiptsTotal = rc?.Total ?? 0m;
            summary.PaymentCount = pm?.Count ?? 0;
            summary.PaymentsTotal = pm?.Total ?? 0m;

            // Pending / post-dated cheques (all-time outstanding).
            var dueSoonEnd = today.AddDays(7);
            var pendingCheques = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled
                         && (p.ChequeStatus == ChequeStatus.Pending || p.ChequeStatus == ChequeStatus.Deposited))
                .Select(p => new { p.Direction, p.Amount, p.ChequeDate })
                .ToListAsync();
            foreach (var c in pendingCheques)
            {
                var slot = c.Direction == PaymentDirection.Receipt ? summary.PdcIn : summary.PdcOut;
                slot.Count++;
                slot.Amount += c.Amount;
                if (c.ChequeDate.HasValue && c.ChequeDate.Value.Date <= dueSoonEnd)
                {
                    slot.DueSoonCount++;
                    slot.DueSoonAmount += c.Amount;
                }
            }

            // Recent money documents (5 each).
            summary.RecentReceipts = await RecentAsync(companyId, PaymentDirection.Receipt);
            summary.RecentPayments = await RecentAsync(companyId, PaymentDirection.Payment);
            return summary;
        }

        private async Task<List<RecentMoneyDocDto>> RecentAsync(int companyId, PaymentDirection direction)
        {
            var prefix = direction == PaymentDirection.Receipt ? "RCP" : "PMT";
            var rows = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && p.Direction == direction && !p.IsCancelled)
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .Take(5)
                .Select(p => new { p.Id, p.Number, p.Date, p.Amount, p.Description, p.ContactType, p.ContactId })
                .ToListAsync();

            var clientIds = rows.Where(r => r.ContactType == "Client" && r.ContactId.HasValue).Select(r => r.ContactId!.Value).ToList();
            var supplierIds = rows.Where(r => r.ContactType == "Supplier" && r.ContactId.HasValue).Select(r => r.ContactId!.Value).ToList();
            var clientNames = clientIds.Count > 0
                ? await _context.Clients.AsNoTracking().Where(c => clientIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id, c => c.Name)
                : new Dictionary<int, string>();
            var supplierNames = supplierIds.Count > 0
                ? await _context.Suppliers.AsNoTracking().Where(s => supplierIds.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => s.Name)
                : new Dictionary<int, string>();

            return rows.Select(r => new RecentMoneyDocDto
            {
                Id = r.Id,
                Reference = $"{prefix}-{r.Number:D4}",
                Date = r.Date,
                Amount = r.Amount,
                Description = r.Description,
                ContactName = r.ContactType == "Client" ? clientNames.GetValueOrDefault(r.ContactId ?? 0)
                            : r.ContactType == "Supplier" ? supplierNames.GetValueOrDefault(r.ContactId ?? 0)
                            : null,
            }).ToList();
        }
    }
}
