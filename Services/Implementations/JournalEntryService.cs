using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class JournalEntryService : IJournalEntryService
    {
        private readonly AppDbContext _context;
        private readonly IGeneralLedgerService _gl;

        public JournalEntryService(AppDbContext context, IGeneralLedgerService gl)
        {
            _context = context;
            _gl = gl;
        }

        // ── Reads ─────────────────────────────────────────────────────────────

        public async Task<PagedResult<JournalEntryDto>> GetPagedAsync(
            int companyId, int page, int pageSize, string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null, bool manualOnly = false)
        {
            var query = _context.JournalEntries.AsNoTracking()
                .Where(e => e.CompanyId == companyId);

            if (manualOnly)
                query = query.Where(e => e.SourceDocType == SourceDocType.ManualJournal);
            if (dateFrom.HasValue)
                query = query.Where(e => e.Date >= dateFrom.Value.Date);
            if (dateTo.HasValue)
                query = query.Where(e => e.Date <= dateTo.Value.Date);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.Trim();
                // "JE-0012" and "12" both mean entry 12 — the operator reads the
                // reference off the screen, so accept it back in that form.
                var digits = new string(term.Where(char.IsDigit).ToArray());
                var asNumber = int.TryParse(digits, out var n) ? n : (int?)null;
                query = query.Where(e =>
                    (e.Narration != null && e.Narration.Contains(term))
                    || (asNumber != null && e.EntryNo == asNumber));
            }

            var totalCount = await query.CountAsync();

            var rows = await query
                .OrderByDescending(e => e.Date).ThenByDescending(e => e.EntryNo)
                .Skip((page - 1) * pageSize).Take(pageSize)
                .Include(e => e.Lines).ThenInclude(l => l.Account)
                .ToListAsync();

            var lockDate = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.GlLockDate).FirstOrDefaultAsync();

            return new PagedResult<JournalEntryDto>
            {
                Items = rows.Select(e => ToDto(e, lockDate)).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<JournalEntryDto?> GetByIdAsync(int id)
        {
            var entry = await _context.JournalEntries.AsNoTracking()
                .Include(e => e.Lines).ThenInclude(l => l.Account)
                .FirstOrDefaultAsync(e => e.Id == id);
            if (entry == null) return null;

            var lockDate = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == entry.CompanyId).Select(c => c.GlLockDate).FirstOrDefaultAsync();
            return ToDto(entry, lockDate);
        }

        // ── Create ────────────────────────────────────────────────────────────

        public async Task<JournalEntryDto> CreateManualAsync(int companyId, CreateJournalEntryDto dto)
        {
            await AssertPostableAsync(companyId);
            var date = dto.Date == default ? DateTime.UtcNow.Date : dto.Date.Date;
            await ValidateManualLinesAsync(companyId, dto);

            var entry = new JournalEntry
            {
                CompanyId = companyId,
                Date = date,
                Narration = Trimmed(dto.Narration),
                SourceDocType = SourceDocType.ManualJournal,
                SourceDocId = null,
                Lines = dto.Lines.Select(l => new JournalLine
                {
                    AccountId = l.AccountId,
                    Debit = l.Debit,
                    Credit = l.Credit,
                    Description = Trimmed(l.Description),
                }).ToList(),
            };

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // The balance, one-side-per-line, account-ownership and
                // period-open rules all live in WriteEntryAsync — there is
                // exactly one place an entry is written.
                await _gl.WriteEntryAsync(entry);
                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return (await GetByIdAsync(entry.Id))!;
        }

        // ── Update (manual journals only) ─────────────────────────────────────

        public async Task<JournalEntryDto?> UpdateManualAsync(int id, CreateJournalEntryDto dto)
        {
            var entry = await _context.JournalEntries
                .Include(e => e.Lines)
                .FirstOrDefaultAsync(e => e.Id == id);
            if (entry == null) return null;
            if (entry.SourceDocType != SourceDocType.ManualJournal)
                throw new InvalidOperationException(
                    "System-posted entries can't be edited — edit the source document instead.");

            var companyId = entry.CompanyId;
            await AssertPostableAsync(companyId);

            // Both dates, so an entry can move neither out of nor into a closed
            // period. Checking only the incoming date would let a filed month be
            // emptied by re-dating its entries forward.
            var newDate = dto.Date == default ? entry.Date : dto.Date.Date;
            await _gl.AssertPeriodOpenAsync(companyId, entry.Date);
            await _gl.AssertPeriodOpenAsync(companyId, newDate);

            await ValidateManualLinesAsync(companyId, dto);

            var newLines = dto.Lines.Select(l => new JournalLine
            {
                JournalEntryId = entry.Id,
                AccountId = l.AccountId,
                Debit = l.Debit,
                Credit = l.Credit,
                Description = Trimmed(l.Description),
            }).ToList();

            // An edit replaces the lines in place, so it never passes through
            // WriteEntryAsync — it has to assert the same invariant itself, or
            // an unbalanced edit walks straight into the ledger.
            await _gl.AssertEntryIsLegalAsync(companyId, newLines);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                entry.Date = newDate;
                entry.Narration = Trimmed(dto.Narration);

                // Replace the lines wholesale — a manual journal has no identity
                // below the entry, so matching old lines to new ones would be
                // guesswork with nothing to gain.
                _context.JournalLines.RemoveRange(entry.Lines);
                await _context.SaveChangesAsync();
                _context.JournalLines.AddRange(newLines);
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

        // ── Delete (manual journals only) ─────────────────────────────────────

        public async Task<bool> DeleteManualAsync(int id)
        {
            var entry = await _context.JournalEntries.FirstOrDefaultAsync(e => e.Id == id);
            if (entry == null) return false;
            if (entry.SourceDocType != SourceDocType.ManualJournal)
                throw new InvalidOperationException(
                    "System-posted entries can't be deleted — edit the source document instead.");

            await _gl.AssertPeriodOpenAsync(entry.CompanyId, entry.Date);

            _context.JournalEntries.Remove(entry);   // lines cascade
            await _context.SaveChangesAsync();
            return true;
        }

        // ── Validation ────────────────────────────────────────────────────────

        private async Task AssertPostableAsync(int companyId)
        {
            if (!await _gl.IsEnabledAsync(companyId))
                throw new InvalidOperationException(
                    "This company's ledger is not live yet, so it can't take journal entries.");
        }

        /// <summary>
        /// The rules that apply to a MANUAL journal specifically. The structural
        /// ones — balanced, one side per line, accounts of this company, period
        /// open — belong to every entry and are enforced in
        /// <see cref="IGeneralLedgerService.WriteEntryAsync"/>; duplicating them
        /// here would create a second place for them to drift.
        /// </summary>
        private async Task ValidateManualLinesAsync(int companyId, CreateJournalEntryDto dto)
        {
            if (dto.Lines == null || dto.Lines.Count < 2)
                throw new InvalidOperationException("A journal entry needs at least two lines.");

            var accountIds = dto.Lines.Select(l => l.AccountId).Distinct().ToList();
            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => accountIds.Contains(a.Id) && a.CompanyId == companyId && a.IsActive)
                .Select(a => new { a.Id, a.ControlType, GroupName = a.AccountGroup.Name })
                .ToListAsync();
            if (accounts.Count != accountIds.Count)
                throw new InvalidOperationException(
                    "One or more accounts do not belong to this company or are inactive.");

            // Money accounts move through their own documents — receipts,
            // payments, transfers — so the bank/cash subledger stays
            // reconcilable against a statement. A journal that credits the bank
            // directly leaves a movement no receipt explains. An account counts
            // as bank/cash when it carries the flag OR sits in a bank/cash
            // group, because an imported chart often has the group and not the
            // flag.
            if (accounts.Any(a => a.ControlType == ControlType.BankCash
                || a.GroupName.Contains("bank", StringComparison.OrdinalIgnoreCase)
                || a.GroupName.Contains("cash", StringComparison.OrdinalIgnoreCase)))
            {
                throw new InvalidOperationException(
                    "Bank and cash accounts can't be posted through a journal entry — use a receipt, a payment or a transfer.");
            }
        }

        // ── Mapping ───────────────────────────────────────────────────────────

        private static JournalEntryDto ToDto(JournalEntry e, DateTime? lockDate) => new()
        {
            Id = e.Id,
            CompanyId = e.CompanyId,
            EntryNo = e.EntryNo,
            Reference = $"JE-{e.EntryNo:D4}",
            Date = e.Date,
            Narration = e.Narration,
            SourceDocType = e.SourceDocType.ToString(),
            SourceDocId = e.SourceDocId,
            TotalDebit = e.Lines.Sum(l => l.Debit),
            TotalCredit = e.Lines.Sum(l => l.Credit),
            CreatedAt = e.CreatedAt,
            IsManual = e.SourceDocType == SourceDocType.ManualJournal,
            IsLocked = lockDate.HasValue && e.Date.Date <= lockDate.Value.Date,
            Lines = e.Lines.OrderBy(l => l.Id).Select(l => new JournalLineDto
            {
                Id = l.Id,
                AccountId = l.AccountId,
                AccountName = l.Account?.Name ?? "",
                AccountCode = l.Account?.Code,
                Debit = l.Debit,
                Credit = l.Credit,
                Description = l.Description,
                PartyType = l.PartyType,
                PartyId = l.PartyId,
                InvoiceId = l.InvoiceId,
                PurchaseBillId = l.PurchaseBillId,
            }).ToList(),
        };

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
