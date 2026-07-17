using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class JournalEntryService : IJournalEntryService
    {
        private readonly AppDbContext _context;
        private readonly IPostingService _posting;
        private readonly ILogger<JournalEntryService> _logger;

        public JournalEntryService(AppDbContext context, IPostingService posting,
            ILogger<JournalEntryService> logger)
        {
            _context = context;
            _posting = posting;
            _logger = logger;
        }

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<PagedResult<JournalEntryDto>> GetPagedAsync(
            int companyId, int page, int pageSize, string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null, bool manualOnly = false)
        {
            page = PaginationHelper.ClampPage(page);
            pageSize = PaginationHelper.Clamp(pageSize);

            var query = _context.JournalEntries.AsNoTracking()
                .Where(e => e.CompanyId == companyId);

            if (manualOnly)
                query = query.Where(e => e.SourceDocType == SourceDocType.ManualJournal);
            if (dateFrom.HasValue)
                query = query.Where(e => e.Date >= dateFrom.Value.Date);
            if (dateTo.HasValue)
            {
                var toExclusive = dateTo.Value.Date.AddDays(1);
                query = query.Where(e => e.Date < toExclusive);
            }
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim();
                // "JE-0012" (or "je12") searches by entry number too.
                var digits = s.StartsWith("JE-", StringComparison.OrdinalIgnoreCase) ? s[3..]
                           : s.StartsWith("JE", StringComparison.OrdinalIgnoreCase) ? s[2..]
                           : s;
                var byNumber = int.TryParse(digits, out var entryNo);
                query = query.Where(e =>
                    (e.Narration != null && e.Narration.Contains(s))
                    || (byNumber && e.EntryNo == entryNo));
            }

            var total = await query.CountAsync();
            var items = await query
                .OrderByDescending(e => e.Date)
                .ThenByDescending(e => e.EntryNo)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Include(e => e.Lines)
                .ThenInclude(l => l.Account)
                .ToListAsync();

            var divisionNames = await ResolveDivisionNamesAsync(items);
            return new PagedResult<JournalEntryDto>
            {
                Items = items.Select(e => ToDto(e, divisionNames)).ToList(),
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<JournalEntryDto?> GetByIdAsync(int id)
        {
            var entry = await _context.JournalEntries.AsNoTracking()
                .Include(e => e.Lines)
                .ThenInclude(l => l.Account)
                .FirstOrDefaultAsync(e => e.Id == id);
            if (entry == null) return null;
            var divisionNames = await ResolveDivisionNamesAsync(new[] { entry });
            return ToDto(entry, divisionNames);
        }

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<JournalEntryDto> CreateManualAsync(int companyId, CreateJournalEntryDto dto)
        {
            var date = dto.Date == default ? PakistanClock.Today : dto.Date.Date;

            // Manual journals ARE ledger writes — meaningless (and unbalanced
            // against nothing) while the company's GL is off.
            if (!await _posting.IsEnabledAsync(companyId))
                throw new InvalidOperationException("Enable GL posting for this company first.");

            // Period-close guard (GL lock date) before any writes.
            await _posting.AssertPeriodOpenAsync(companyId, date);

            await ValidateLinesAsync(companyId, dto);

            var entry = new JournalEntry
            {
                CompanyId = companyId,
                Date = date,
                Narration = Trimmed(dto.Narration),
                SourceDocType = SourceDocType.ManualJournal,
                SourceDocId = null,
                DivisionId = dto.DivisionId,
                Lines = dto.Lines.Select(l => new JournalLine
                {
                    AccountId = l.AccountId,
                    Debit = l.Debit,
                    Credit = l.Credit,
                    Description = Trimmed(l.Description),
                    DivisionId = dto.DivisionId,
                }).ToList(),
            };

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.JournalEntries.Add(entry);

                // JE-#### sequence per company; the loser of a concurrent create
                // retries on the (CompanyId, EntryNo) unique-index violation.
                await NumberAllocationRetry.ExecuteAsync(async _ =>
                {
                    entry.EntryNo = (await _context.JournalEntries
                        .Where(e => e.CompanyId == companyId)
                        .MaxAsync(e => (int?)e.EntryNo) ?? 0) + 1;
                    await _context.SaveChangesAsync();
                    return entry.Id;
                });

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return (await GetByIdAsync(entry.Id))!;
        }

        // ── Update (full edit, manual journals only) ─────────────────────────

        public async Task<JournalEntryDto?> UpdateManualAsync(int id, CreateJournalEntryDto dto)
        {
            var entry = await _context.JournalEntries
                .Include(e => e.Lines)
                .FirstOrDefaultAsync(e => e.Id == id);   // tracked, incl. lines
            if (entry == null) return null;
            if (entry.SourceDocType != SourceDocType.ManualJournal)
                throw new InvalidOperationException(
                    "System-posted entries can't be edited — edit the source document instead.");

            var companyId = entry.CompanyId;
            if (!await _posting.IsEnabledAsync(companyId))
                throw new InvalidOperationException("Enable GL posting for this company first.");

            // Period-close guard: the entry can't move out of OR into a locked
            // period, so check both the stored and the incoming date.
            var newDate = dto.Date == default ? entry.Date : dto.Date.Date;
            await _posting.AssertPeriodOpenAsync(companyId, entry.Date);
            await _posting.AssertPeriodOpenAsync(companyId, newDate);

            await ValidateLinesAsync(companyId, dto);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // Header edit — EntryNo is preserved.
                entry.Date = newDate;
                entry.Narration = Trimmed(dto.Narration);
                entry.DivisionId = dto.DivisionId;

                // Replace lines wholesale.
                _context.JournalLines.RemoveRange(entry.Lines);
                await _context.SaveChangesAsync();
                _context.JournalLines.AddRange(dto.Lines.Select(l => new JournalLine
                {
                    JournalEntryId = entry.Id,
                    AccountId = l.AccountId,
                    Debit = l.Debit,
                    Credit = l.Credit,
                    Description = Trimmed(l.Description),
                    DivisionId = dto.DivisionId,
                }));
                await _context.SaveChangesAsync();

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return await GetByIdAsync(entry.Id);
        }

        // ── Delete (manual journals only) ────────────────────────────────────

        public async Task<bool> DeleteManualAsync(int id)
        {
            var entry = await _context.JournalEntries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry == null) return false;
            if (entry.SourceDocType != SourceDocType.ManualJournal)
                throw new InvalidOperationException(
                    "System-posted entries can't be deleted — edit the source document instead.");

            // Period-close guard: a locked entry can't be deleted either.
            await _posting.AssertPeriodOpenAsync(entry.CompanyId, entry.Date);

            _context.JournalEntries.Remove(entry); // lines cascade
            await _context.SaveChangesAsync();
            return true;
        }

        // ── Validation ───────────────────────────────────────────────────────

        /// <summary>Shared create/update line validation: ≥ 2 lines, exactly one
        /// side per line, balanced totals, accounts belong to this company +
        /// active + not bank/cash, division belongs to this company.</summary>
        private async Task ValidateLinesAsync(int companyId, CreateJournalEntryDto dto)
        {
            if (dto.Lines == null || dto.Lines.Count < 2)
                throw new InvalidOperationException("A journal entry needs at least two lines.");

            foreach (var l in dto.Lines)
            {
                if (l.Debit < 0 || l.Credit < 0)
                    throw new InvalidOperationException("Debit and credit amounts can't be negative.");
                // Exactly one side > 0 (the other must be zero).
                if ((l.Debit > 0) == (l.Credit > 0))
                    throw new InvalidOperationException(
                        "Each line must have an amount on exactly one side — debit or credit, not both.");
            }

            var totalDebit = dto.Lines.Sum(l => l.Debit);
            var totalCredit = dto.Lines.Sum(l => l.Credit);
            if (totalDebit != totalCredit)
                throw new InvalidOperationException(
                    $"The entry doesn't balance: debits ({totalDebit:0.00}) must equal credits ({totalCredit:0.00}).");
            if (totalDebit <= 0)
                throw new InvalidOperationException("A journal entry must move a non-zero amount.");

            // Cross-tenant guard: every line account must be an ACTIVE account
            // of THIS company (never trust body ids — CLAUDE.md §1/§4).
            var accountIds = dto.Lines.Select(l => l.AccountId).Distinct().ToList();
            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => accountIds.Contains(a.Id) && a.CompanyId == companyId && a.IsActive)
                .Select(a => new { a.Id, a.ControlType, GroupName = a.AccountGroup.Name })
                .ToListAsync();
            if (accounts.Count != accountIds.Count)
                throw new InvalidOperationException(
                    "One or more accounts do not belong to this company or are inactive.");

            // Money accounts move via their own documents (receipts, payments,
            // transfers) so the bank/cash subledger stays reconcilable — the
            // reference product enforces the same rule. An account is bank/cash
            // when flagged BankCash OR when it sits in a bank/cash group
            // (migrated accounts often carry the group but not the flag).
            var bankish = accounts.Any(a => a.ControlType == ControlType.BankCash
                || a.GroupName.Contains("bank", StringComparison.OrdinalIgnoreCase)
                || a.GroupName.Contains("cash", StringComparison.OrdinalIgnoreCase));
            if (bankish)
                throw new InvalidOperationException(
                    "Bank and cash accounts can't be posted via journal entries — use receipts, payments, or transfers.");

            // Optional Division tag must belong to this company when supplied.
            if (dto.DivisionId.HasValue &&
                !await _context.Divisions.AnyAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == companyId))
                throw new InvalidOperationException("Division does not belong to this company.");
        }

        // ── Mapping ──────────────────────────────────────────────────────────

        private static JournalEntryDto ToDto(JournalEntry e, IReadOnlyDictionary<int, string> divisionNames)
        {
            return new JournalEntryDto
            {
                Id = e.Id,
                CompanyId = e.CompanyId,
                EntryNo = e.EntryNo,
                Reference = $"JE-{e.EntryNo:D4}",
                Date = e.Date,
                Narration = e.Narration,
                SourceDocType = e.SourceDocType.ToString(),
                SourceDocId = e.SourceDocId,
                DivisionId = e.DivisionId,
                DivisionName = e.DivisionId.HasValue && divisionNames.TryGetValue(e.DivisionId.Value, out var dn)
                    ? dn : null,
                TotalDebit = e.Lines.Sum(l => l.Debit),
                TotalCredit = e.Lines.Sum(l => l.Credit),
                Lines = e.Lines.OrderBy(l => l.Id).Select(l => new JournalLineDto
                {
                    Id = l.Id,
                    AccountId = l.AccountId,
                    AccountName = l.Account?.Name ?? "",
                    AccountCode = l.Account?.Code,
                    Debit = l.Debit,
                    Credit = l.Credit,
                    Description = l.Description,
                }).ToList(),
                CreatedAt = e.CreatedAt,
                IsManual = e.SourceDocType == SourceDocType.ManualJournal,
            };
        }

        /// <summary>Batch-resolve Division display names for a set of entries
        /// (JournalEntry has no Division nav — avoids an N+1 in list views).</summary>
        private async Task<Dictionary<int, string>> ResolveDivisionNamesAsync(IEnumerable<JournalEntry> entries)
        {
            var ids = entries.Where(e => e.DivisionId.HasValue)
                .Select(e => e.DivisionId!.Value).Distinct().ToList();
            if (ids.Count == 0) return new Dictionary<int, string>();
            return await _context.Divisions.AsNoTracking()
                .Where(d => ids.Contains(d.Id))
                .Select(d => new { d.Id, d.Name })
                .ToDictionaryAsync(d => d.Id, d => d.Name);
        }

        public async Task<PrintJournalEntryDto?> GetPrintDataAsync(int id)
        {
            var je = await _context.JournalEntries.AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.Lines).ThenInclude(l => l.Account)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (je == null) return null;
            var division = je.DivisionId.HasValue
                ? await _context.Divisions.AsNoTracking().FirstOrDefaultAsync(d => d.Id == je.DivisionId.Value)
                : null;
            var sNo = 0;
            // Debit lines first, then credit lines — the conventional voucher order.
            var lines = je.Lines
                .OrderByDescending(l => l.Debit > 0)
                .ThenBy(l => l.Id)
                .Select(l => new PrintJournalLineDto
                {
                    SNo = ++sNo,
                    AccountCode = l.Account?.Code,
                    AccountName = l.Account?.Name ?? "",
                    Description = l.Description,
                    Debit = l.Debit,
                    Credit = l.Credit,
                }).ToList();
            return new PrintJournalEntryDto
            {
                CompanyBrandName = je.Company?.BrandName ?? je.Company?.Name ?? "",
                CompanyLogoPath = je.Company?.LogoPath,
                CompanyAddress = je.Company?.FullAddress,
                CompanyPhone = je.Company?.Phone,
                DivisionName = division?.Name,
                DivisionBrandName = division?.BrandName,
                DivisionLogoPath = division?.LogoPath,
                DivisionAddress = division?.FullAddress,
                DivisionPhone = division?.Phone,
                DivisionNTN = division?.NTN,
                DivisionSTRN = division?.STRN,
                DivisionEmail = division?.Email,
                Reference = "JE-" + je.EntryNo,
                EntryNo = je.EntryNo,
                Date = je.Date,
                Narration = je.Narration,
                TotalDebit = je.Lines.Sum(l => l.Debit),
                TotalCredit = je.Lines.Sum(l => l.Credit),
                Lines = lines,
            };
        }

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
