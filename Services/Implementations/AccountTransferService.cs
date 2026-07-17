using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>Inter-account transfers (design: the reference product's
    /// "Inter Account Transfers" tab). A first-class document — no contact,
    /// no allocations — whose GL posting is Dr receiving / Cr paying account.</summary>
    public class AccountTransferService : IAccountTransferService
    {
        private readonly AppDbContext _context;
        private readonly IPostingService _posting;
        private readonly ILogger<AccountTransferService> _logger;

        public AccountTransferService(AppDbContext context, IPostingService posting,
            ILogger<AccountTransferService> logger)
        {
            _context = context;
            _posting = posting;
            _logger = logger;
        }

        // ── Reads ────────────────────────────────────────────────────────────

        public async Task<PagedResult<AccountTransferDto>> GetPagedAsync(
            int companyId, int page, int pageSize,
            string? search = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var query = BaseQuery().Where(r => r.Transfer.CompanyId == companyId);

            if (dateFrom.HasValue)
                query = query.Where(r => r.Transfer.Date >= dateFrom.Value);
            if (dateTo.HasValue)
                query = query.Where(r => r.Transfer.Date <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(r =>
                    r.Transfer.Number.ToString().Contains(term) ||
                    (r.Transfer.Description != null && r.Transfer.Description.ToLower().Contains(term)) ||
                    r.FromName.ToLower().Contains(term) ||
                    r.ToName.ToLower().Contains(term));
            }

            var totalCount = await query.CountAsync();
            var rows = await query
                .OrderByDescending(r => r.Transfer.Date).ThenByDescending(r => r.Transfer.Number)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();

            return new PagedResult<AccountTransferDto>
            {
                Items = rows.Select(ToDto).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<AccountTransferDto?> GetByIdAsync(int id)
        {
            var row = await BaseQuery().FirstOrDefaultAsync(r => r.Transfer.Id == id);
            return row == null ? null : ToDto(row);
        }

        // ── Create ───────────────────────────────────────────────────────────

        public async Task<AccountTransferDto> CreateAsync(int companyId, CreateAccountTransferDto dto)
        {
            var date = dto.Date == default ? PakistanClock.Today : dto.Date;
            await ValidateAsync(companyId, dto, date);

            var transfer = new AccountTransfer
            {
                CompanyId = companyId,
                Date = date,
                // Cleared-by-default (Manager-style) — see PaymentService.CreateAsync.
                ReconciledDate = date,
                FromAccountId = dto.FromAccountId,
                ToAccountId = dto.ToAccountId,
                Amount = dto.Amount,
                Description = Trimmed(dto.Description),
                DivisionId = dto.DivisionId,
            };

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                _context.AccountTransfers.Add(transfer);

                // Allocate the per-company number; the loser of a concurrent
                // create retries on the unique-index violation (CompanyId, Number).
                await NumberAllocationRetry.ExecuteAsync(async _ =>
                {
                    var max = await _context.AccountTransfers
                        .Where(t => t.CompanyId == companyId)
                        .MaxAsync(t => (int?)t.Number) ?? 0;
                    transfer.Number = max + 1;
                    await _context.SaveChangesAsync();
                    return transfer.Id;
                });

                // GL posting (no-op unless the company enabled it) — same tx,
                // so the document and its ledger entry commit or roll back together.
                await _posting.PostTransferAsync(transfer);

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return (await GetByIdAsync(transfer.Id))!;
        }

        // ── Update (full edit) ─────────────────────────────────────────────────

        public async Task<AccountTransferDto?> UpdateAsync(int id, CreateAccountTransferDto dto)
        {
            var transfer = await _context.AccountTransfers.FirstOrDefaultAsync(t => t.Id == id);
            if (transfer == null) return null;
            var companyId = transfer.CompanyId;

            // Period-close guard: the transfer can't move out of OR into a
            // locked period, so check both the stored and the incoming date.
            await _posting.AssertPeriodOpenAsync(companyId, transfer.Date);
            var newDate = dto.Date == default ? transfer.Date : dto.Date;
            await ValidateAsync(companyId, dto, newDate);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                transfer.Date = newDate;
                transfer.FromAccountId = dto.FromAccountId;
                transfer.ToAccountId = dto.ToAccountId;
                transfer.Amount = dto.Amount;
                transfer.Description = Trimmed(dto.Description);
                transfer.DivisionId = dto.DivisionId;
                await _context.SaveChangesAsync();

                // Re-post: the engine replaces this transfer's journal entry so
                // the ledger mirrors the edited accounts/amount/date.
                await _posting.PostTransferAsync(transfer);

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }

            return await GetByIdAsync(transfer.Id);
        }

        // ── Delete ───────────────────────────────────────────────────────────

        public async Task<bool> DeleteAsync(int id)
        {
            var transfer = await _context.AccountTransfers.FirstOrDefaultAsync(t => t.Id == id);
            if (transfer == null) return false;

            // Period-close guard: a locked transfer can't be deleted either.
            await _posting.AssertPeriodOpenAsync(transfer.CompanyId, transfer.Date);

            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                // The ledger entry dies with its document.
                await _posting.RemoveForSourceAsync(transfer.CompanyId,
                    SourceDocType.AccountTransfer, transfer.Id);

                _context.AccountTransfers.Remove(transfer);
                await _context.SaveChangesAsync();

                await tx.CommitAsync();
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
            return true;
        }

        // ── Validation ─────────────────────────────────────────────────────────

        /// <summary>Shared create/update validation. Both account ids come from
        /// the request body and are never trusted: they must be THIS company's
        /// active bank/cash accounts (same heuristic as
        /// AccountService.GetBankCashAccountsAsync — the picker's source list).
        /// Ends with the period-close guard on the effective document date.</summary>
        private async Task ValidateAsync(int companyId, CreateAccountTransferDto dto, DateTime date)
        {
            if (dto.Amount <= 0)
                throw new InvalidOperationException("Transfer amount must be greater than zero.");
            if (dto.FromAccountId == dto.ToAccountId)
                throw new InvalidOperationException("From and To accounts must be different.");

            var accounts = await _context.Accounts.AsNoTracking()
                .Include(a => a.AccountGroup)
                .Where(a => a.CompanyId == companyId
                         && (a.Id == dto.FromAccountId || a.Id == dto.ToAccountId))
                .ToListAsync();
            var from = accounts.FirstOrDefault(a => a.Id == dto.FromAccountId);
            var to = accounts.FirstOrDefault(a => a.Id == dto.ToAccountId);
            if (from == null || to == null)
                throw new InvalidOperationException("One or more accounts do not belong to this company.");
            if (!IsBankCash(from) || !IsBankCash(to))
                throw new InvalidOperationException("Both accounts must be bank or cash accounts.");

            // Optional Division tag must belong to this company when supplied.
            if (dto.DivisionId.HasValue &&
                !await _context.Divisions.AnyAsync(d => d.Id == dto.DivisionId.Value && d.CompanyId == companyId))
                throw new InvalidOperationException("Division does not belong to this company.");

            // Period-close guard (GL lock date) before any writes.
            await _posting.AssertPeriodOpenAsync(companyId, date);
        }

        /// <summary>Mirror of AccountService.GetBankCashAccountsAsync: active
        /// Asset account that is either flagged BankCash or sits in a group
        /// whose name contains "bank"/"cash" (migrated charts aren't flagged).</summary>
        private static bool IsBankCash(Account a)
        {
            var group = (a.AccountGroup?.Name ?? "").ToLowerInvariant();
            return a.IsActive
                && a.AccountType == AccountType.Asset
                && (a.ControlType == ControlType.BankCash
                    || group.Contains("bank") || group.Contains("cash"));
        }

        // ── Query + mapping ────────────────────────────────────────────────────

        /// <summary>Transfers joined to their account names (and optional
        /// Division name) in one round-trip — list views render without N+1.</summary>
        private IQueryable<TransferRow> BaseQuery() =>
            from t in _context.AccountTransfers.AsNoTracking()
            join fa in _context.Accounts.AsNoTracking() on t.FromAccountId equals fa.Id
            join ta in _context.Accounts.AsNoTracking() on t.ToAccountId equals ta.Id
            join dv in _context.Divisions.AsNoTracking() on t.DivisionId equals (int?)dv.Id into dj
            from dv in dj.DefaultIfEmpty()
            select new TransferRow
            {
                Transfer = t,
                FromName = fa.Name,
                ToName = ta.Name,
                DivisionName = dv != null ? dv.Name : null,
            };

        private sealed class TransferRow
        {
            public AccountTransfer Transfer { get; set; } = null!;
            public string FromName { get; set; } = "";
            public string ToName { get; set; } = "";
            public string? DivisionName { get; set; }
        }

        private static AccountTransferDto ToDto(TransferRow row)
        {
            var t = row.Transfer;
            return new AccountTransferDto
            {
                Id = t.Id,
                CompanyId = t.CompanyId,
                Number = t.Number,
                Reference = $"TRF-{t.Number:D4}",
                Date = t.Date,
                FromAccountId = t.FromAccountId,
                FromAccountName = row.FromName,
                ToAccountId = t.ToAccountId,
                ToAccountName = row.ToName,
                Amount = t.Amount,
                Description = t.Description,
                DivisionId = t.DivisionId,
                DivisionName = row.DivisionName,
                CreatedAt = t.CreatedAt,
            };
        }

        public async Task<PrintTransferDto?> GetPrintDataAsync(int id)
        {
            var t = await _context.AccountTransfers.AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.FromAccount)
                .Include(x => x.ToAccount)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (t == null) return null;
            var division = t.DivisionId.HasValue
                ? await _context.Divisions.AsNoTracking().FirstOrDefaultAsync(d => d.Id == t.DivisionId.Value)
                : null;
            return new PrintTransferDto
            {
                CompanyBrandName = t.Company?.BrandName ?? t.Company?.Name ?? "",
                CompanyLogoPath = t.Company?.LogoPath,
                CompanyAddress = t.Company?.FullAddress,
                CompanyPhone = t.Company?.Phone,
                DivisionName = division?.Name,
                DivisionBrandName = division?.BrandName,
                DivisionLogoPath = division?.LogoPath,
                DivisionAddress = division?.FullAddress,
                DivisionPhone = division?.Phone,
                DivisionNTN = division?.NTN,
                DivisionSTRN = division?.STRN,
                DivisionEmail = division?.Email,
                Reference = "TRF-" + t.Number,
                Date = t.Date,
                FromAccountName = t.FromAccount?.Name ?? "",
                ToAccountName = t.ToAccount?.Name ?? "",
                Description = t.Description,
                Amount = t.Amount,
                AmountInWords = NumberToWordsConverter.Convert(t.Amount),
            };
        }

        private static string? Trimmed(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }
}
