using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class GeneralLedgerService : IGeneralLedgerService
    {
        private readonly AppDbContext _context;

        public GeneralLedgerService(AppDbContext context)
        {
            _context = context;
        }

        // ── Policy ────────────────────────────────────────────────────────────

        public async Task<bool> IsEnabledAsync(int companyId) =>
            await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => c.GlPostingEnabled)
                .FirstOrDefaultAsync();

        public async Task AssertPeriodOpenAsync(int companyId, DateTime date)
        {
            var lockDate = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => c.GlLockDate)
                .FirstOrDefaultAsync();
            if (lockDate.HasValue && date.Date <= lockDate.Value.Date)
                throw new InvalidOperationException(
                    $"The accounting period is closed up to {lockDate.Value:dd MMM yyyy}. " +
                    "Nothing dated on or before that day can be added, changed or removed.");
        }

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

        public async Task SetLockDateAsync(int companyId, DateTime? lockDate)
        {
            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId)
                ?? throw new InvalidOperationException("Company not found.");
            company.GlLockDate = lockDate?.Date;
            await _context.SaveChangesAsync();
        }

        // ── Writing ───────────────────────────────────────────────────────────

        public async Task AssertEntryIsLegalAsync(int companyId, IReadOnlyCollection<JournalLine> lines)
        {
            if (lines == null || lines.Count < 2)
                throw new InvalidOperationException("A journal entry needs at least two lines.");

            foreach (var l in lines)
            {
                if (l.Debit < 0 || l.Credit < 0)
                    throw new InvalidOperationException("Debit and credit amounts can't be negative.");
                // Exactly one side carries the amount. Allowing both would make
                // "Dr 100 / Cr 100" a legal no-op line that still balances, and
                // every reader downstream would have to net it.
                if ((l.Debit > 0) == (l.Credit > 0))
                    throw new InvalidOperationException(
                        "Each line must have an amount on exactly one side — debit or credit, not both.");
            }

            var totalDebit = lines.Sum(l => l.Debit);
            var totalCredit = lines.Sum(l => l.Credit);
            if (totalDebit != totalCredit)
                throw new InvalidOperationException(
                    $"The entry doesn't balance: debits ({totalDebit:0.00}) must equal credits ({totalCredit:0.00}).");
            if (totalDebit <= 0m)
                throw new InvalidOperationException("A journal entry must move a non-zero amount.");

            // Every account must belong to THIS company. An id arriving from a
            // request body is not evidence of anything (CLAUDE.md §1).
            var accountIds = lines.Select(l => l.AccountId).Distinct().ToList();
            var ownedCount = await _context.Accounts.AsNoTracking()
                .CountAsync(a => accountIds.Contains(a.Id) && a.CompanyId == companyId);
            if (ownedCount != accountIds.Count)
                throw new InvalidOperationException("One or more accounts do not belong to this company.");
        }

        public async Task<JournalEntry> WriteEntryAsync(JournalEntry entry)
        {
            if (entry == null) throw new ArgumentNullException(nameof(entry));

            var lines = entry.Lines?.ToList() ?? new List<JournalLine>();
            await AssertEntryIsLegalAsync(entry.CompanyId, lines);

            entry.Date = entry.Date.Date;
            await AssertPeriodOpenAsync(entry.CompanyId, entry.Date);

            // Replace-on-edit: a document owns at most one entry, so re-posting
            // it after an edit replaces rather than adds. Without this, editing
            // a bill five times books it five times and the books still balance.
            if (entry.SourceDocId.HasValue)
            {
                var existing = await _context.JournalEntries
                    .Where(e => e.CompanyId == entry.CompanyId
                             && e.SourceDocType == entry.SourceDocType
                             && e.SourceDocId == entry.SourceDocId)
                    .ToListAsync();
                if (existing.Count > 0)
                {
                    _context.JournalEntries.RemoveRange(existing);   // lines cascade
                    await _context.SaveChangesAsync();
                }
            }

            _context.JournalEntries.Add(entry);

            // JE-#### per company. The loser of a concurrent create retries on
            // the (CompanyId, EntryNo) unique-index violation, the same way
            // document numbers are allocated.
            await NumberAllocationRetry.ExecuteAsync(async _ =>
            {
                entry.EntryNo = (await _context.JournalEntries
                    .Where(e => e.CompanyId == entry.CompanyId && e.Id != entry.Id)
                    .MaxAsync(e => (int?)e.EntryNo) ?? 0) + 1;
                await _context.SaveChangesAsync();
                return entry.Id;
            });

            return entry;
        }

        public async Task<int> RemoveForDocumentAsync(int companyId, SourceDocType sourceDocType, int sourceDocId)
        {
            var entries = await _context.JournalEntries
                .Where(e => e.CompanyId == companyId
                         && e.SourceDocType == sourceDocType
                         && e.SourceDocId == sourceDocId)
                .ToListAsync();
            if (entries.Count == 0) return 0;

            // A closed period is closed in both directions — removing an entry
            // changes a filed figure exactly as much as adding one does.
            foreach (var e in entries)
                await AssertPeriodOpenAsync(companyId, e.Date);

            _context.JournalEntries.RemoveRange(entries);   // lines cascade
            await _context.SaveChangesAsync();
            return entries.Count;
        }

        // ── Reading ───────────────────────────────────────────────────────────

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

            return opening.ToDictionary(a => a.Id, a => a.Signed + movement.GetValueOrDefault(a.Id));
        }

        public async Task<AccountLedgerDto?> GetAccountLedgerAsync(
            int accountId, DateTime? from, DateTime? to, int page, int pageSize)
        {
            var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.Id == accountId);
            if (account == null) return null;

            page = PaginationHelper.ClampPage(page);
            pageSize = PaginationHelper.Clamp(pageSize, 50, PaginationHelper.AuditMax);

            var signedOpening = account.OpeningBalanceIsDebit ? account.OpeningBalance : -account.OpeningBalance;

            // Movement before the window start rolls into the opening figure, so
            // the running balance on row one is a real balance and not a
            // period-only subtotal pretending to be one.
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

            // The balance carried into this page is the opening plus the net of
            // every row before it, in the same order.
            var beforePage = offset > 0
                ? await query.Take(offset).SumAsync(l => (decimal?)(l.Debit - l.Credit)) ?? 0m
                : 0m;

            var rows = await query.Skip(offset).Take(pageSize)
                .Select(l => new
                {
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
                CompanyId = account.CompanyId,
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
                // A row that is zero everywhere carries no information and makes
                // the real rows harder to find.
                if (signedOpening == 0m && dr == 0m && cr == 0m) continue;

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
    }
}
