using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Bank reconciliation read model + workflow (BANK_RECONCILIATION_DESIGN.md
    /// §4.2–4.3, Phase 1 + 3).
    ///
    /// Actual balance is the GL balance (via AccountService). Pending buckets are
    /// summed from the subledger — receipts/payments (by their resolved bank
    /// account) and transfers (by leg) that have no ReconciledDate. Cleared is
    /// DERIVED: Cleared = Actual − PendingDeposits + PendingWithdrawals. Marking a
    /// transaction cleared and locking a reconciliation are pure metadata — the GL
    /// is never touched.
    /// </summary>
    public class BankReconciliationService : IBankReconciliationService
    {
        private readonly AppDbContext _context;
        private readonly IAccountService _accounts;

        public BankReconciliationService(AppDbContext context, IAccountService accounts)
        {
            _context = context;
            _accounts = accounts;
        }

        // ── Summary (Phase 1) ──────────────────────────────────────────────────

        public async Task<List<BankAccountReconSummaryDto>> GetAccountSummariesAsync(int companyId)
        {
            var accounts = await _accounts.GetBankCashAccountsAsync(companyId);
            if (accounts.Count == 0) return new List<BankAccountReconSummaryDto>();

            var defaultBankId = accounts
                .Where(a => a.ControlType == "BankCash").OrderBy(a => a.Id)
                .Select(a => (int?)a.Id).FirstOrDefault() ?? accounts.OrderBy(a => a.Id).First().Id;

            var valid = accounts.Select(a => a.Id).ToHashSet();
            var pendingDeposits = accounts.ToDictionary(a => a.Id, _ => 0m);
            var pendingWithdrawals = accounts.ToDictionary(a => a.Id, _ => 0m);

            var payments = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled && p.ReconciledDate == null)
                .Select(p => new { p.Direction, p.Amount, p.BankAccountId })
                .ToListAsync();
            foreach (var p in payments)
            {
                var acct = p.BankAccountId.HasValue && valid.Contains(p.BankAccountId.Value)
                    ? p.BankAccountId.Value : defaultBankId;
                if (p.Direction == PaymentDirection.Receipt) pendingDeposits[acct] += p.Amount;
                else pendingWithdrawals[acct] += p.Amount;
            }

            var transfers = await _context.AccountTransfers.AsNoTracking()
                .Where(t => t.CompanyId == companyId && t.ReconciledDate == null)
                .Select(t => new { t.FromAccountId, t.ToAccountId, t.Amount })
                .ToListAsync();
            foreach (var t in transfers)
            {
                if (valid.Contains(t.ToAccountId)) pendingDeposits[t.ToAccountId] += t.Amount;
                if (valid.Contains(t.FromAccountId)) pendingWithdrawals[t.FromAccountId] += t.Amount;
            }

            // Imported-but-uncategorized statement lines (Phase 2), per account.
            var uncat = (await _context.BankStatementLines.AsNoTracking()
                    .Where(l => l.CompanyId == companyId && l.Status == BankStatementLineStatus.Uncategorized)
                    .Select(l => new { l.BankAccountId, l.Amount })
                    .ToListAsync())
                .GroupBy(l => l.BankAccountId)
                .ToDictionary(g => g.Key, g => new
                {
                    Receipts = g.Where(x => x.Amount >= 0).Sum(x => x.Amount),
                    Payments = g.Where(x => x.Amount < 0).Sum(x => -x.Amount),
                    Count = g.Count(),
                });

            return accounts.Select(a =>
            {
                var pd = pendingDeposits.GetValueOrDefault(a.Id);
                var pw = pendingWithdrawals.GetValueOrDefault(a.Id);
                uncat.TryGetValue(a.Id, out var u);
                return new BankAccountReconSummaryDto
                {
                    AccountId = a.Id,
                    Name = a.Name,
                    Code = a.Code,
                    ActualBalance = a.Balance,
                    ClearedBalance = a.Balance - pd + pw,
                    PendingDeposits = pd,
                    PendingWithdrawals = pw,
                    UncategorizedReceipts = u?.Receipts ?? 0m,
                    UncategorizedPayments = u?.Payments ?? 0m,
                    UncategorizedCount = u?.Count ?? 0,
                };
            }).ToList();
        }

        // ── Cleared toggles (Phase 1) — guarded against locked periods (Phase 3) ─

        public async Task<bool> SetPaymentClearedAsync(int paymentId, bool cleared, DateTime? clearedDate)
        {
            var p = await _context.Payments.FirstOrDefaultAsync(x => x.Id == paymentId);
            if (p == null) return false;
            var acct = p.BankAccountId ?? await DefaultBankIdAsync(p.CompanyId);
            await AssertNotLockedAsync(p.CompanyId, acct, p.Date);
            p.ReconciledDate = cleared ? (clearedDate ?? p.Date) : null;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> SetTransferClearedAsync(int transferId, bool cleared, DateTime? clearedDate)
        {
            var t = await _context.AccountTransfers.FirstOrDefaultAsync(x => x.Id == transferId);
            if (t == null) return false;
            await AssertNotLockedAsync(t.CompanyId, t.FromAccountId, t.Date);
            await AssertNotLockedAsync(t.CompanyId, t.ToAccountId, t.Date);
            t.ReconciledDate = cleared ? (clearedDate ?? t.Date) : null;
            await _context.SaveChangesAsync();
            return true;
        }

        // ── Reconcile workflow (Phase 3) ────────────────────────────────────────

        public async Task<List<ReconcileTxnDto>> GetAccountTransactionsAsync(int accountId)
        {
            var companyId = await _context.Accounts.AsNoTracking()
                .Where(a => a.Id == accountId).Select(a => a.CompanyId).FirstOrDefaultAsync();
            if (companyId == 0) return new List<ReconcileTxnDto>();
            var defaultBankId = await DefaultBankIdAsync(companyId);

            var rows = new List<ReconcileTxnDto>();

            var payments = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && !p.IsCancelled)
                .Select(p => new { p.Id, p.Direction, p.Number, p.Date, p.Description, p.Amount, p.BankAccountId, p.ReconciledDate })
                .ToListAsync();
            foreach (var p in payments)
            {
                var acct = p.BankAccountId ?? defaultBankId;
                if (acct != accountId) continue;
                var isReceipt = p.Direction == PaymentDirection.Receipt;
                rows.Add(new ReconcileTxnDto
                {
                    DocType = isReceipt ? "Receipt" : "Payment",
                    DocId = p.Id,
                    Reference = (isReceipt ? "RCV-" : "PMT-") + p.Number,
                    Date = p.Date,
                    Description = p.Description,
                    Amount = isReceipt ? p.Amount : -p.Amount,
                    Cleared = p.ReconciledDate != null,
                });
            }

            var transfers = await _context.AccountTransfers.AsNoTracking()
                .Where(t => t.CompanyId == companyId && (t.FromAccountId == accountId || t.ToAccountId == accountId))
                .Select(t => new { t.Id, t.Number, t.Date, t.Description, t.Amount, t.FromAccountId, t.ToAccountId, t.ReconciledDate })
                .ToListAsync();
            foreach (var t in transfers)
            {
                var inbound = t.ToAccountId == accountId;
                rows.Add(new ReconcileTxnDto
                {
                    DocType = "Transfer",
                    DocId = t.Id,
                    Reference = "TRF-" + t.Number,
                    Date = t.Date,
                    Description = t.Description,
                    Amount = inbound ? t.Amount : -t.Amount,
                    Cleared = t.ReconciledDate != null,
                });
            }

            return rows.OrderByDescending(r => r.Date).ThenBy(r => r.Reference).ToList();
        }

        public async Task<BankReconciliationDto> LockReconciliationAsync(int companyId, LockReconciliationDto dto)
        {
            // Cleared balance snapshot from the live read model (authoritative).
            var summary = await GetAccountSummariesAsync(companyId);
            var acct = summary.FirstOrDefault(a => a.AccountId == dto.BankAccountId)
                ?? throw new InvalidOperationException("Account is not a bank/cash account of this company.");

            var rec = new BankReconciliation
            {
                CompanyId = companyId,
                BankAccountId = dto.BankAccountId,
                StatementDate = dto.StatementDate,
                StatementBalance = dto.StatementBalance,
                ClearedBalance = acct.ClearedBalance,
            };
            _context.BankReconciliations.Add(rec);
            await _context.SaveChangesAsync();

            return new BankReconciliationDto
            {
                Id = rec.Id,
                BankAccountId = rec.BankAccountId,
                StatementDate = rec.StatementDate,
                StatementBalance = rec.StatementBalance,
                ClearedBalance = rec.ClearedBalance,
                Difference = rec.ClearedBalance - rec.StatementBalance,
                CreatedAt = rec.CreatedAt,
            };
        }

        public async Task<List<BankReconciliationDto>> GetReconciliationsAsync(int accountId)
        {
            return await _context.BankReconciliations.AsNoTracking()
                .Where(r => r.BankAccountId == accountId)
                .OrderByDescending(r => r.StatementDate).ThenByDescending(r => r.Id)
                .Select(r => new BankReconciliationDto
                {
                    Id = r.Id,
                    BankAccountId = r.BankAccountId,
                    StatementDate = r.StatementDate,
                    StatementBalance = r.StatementBalance,
                    ClearedBalance = r.ClearedBalance,
                    Difference = r.ClearedBalance - r.StatementBalance,
                    CreatedAt = r.CreatedAt,
                })
                .ToListAsync();
        }

        // ── Helpers ─────────────────────────────────────────────────────────────

        private async Task<int> DefaultBankIdAsync(int companyId) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType == ControlType.BankCash)
                .OrderBy(a => a.Id).Select(a => a.Id).FirstOrDefaultAsync();

        /// <summary>Block cleared-state changes on a transaction that falls inside a
        /// locked reconciliation window (statement date on/after the txn date) —
        /// a signed-off statement must not silently change underneath.</summary>
        private async Task AssertNotLockedAsync(int companyId, int accountId, DateTime txnDate)
        {
            var locked = await _context.BankReconciliations.AsNoTracking().AnyAsync(r =>
                r.CompanyId == companyId && r.BankAccountId == accountId && r.StatementDate >= txnDate);
            if (locked)
                throw new InvalidOperationException(
                    "This transaction is inside a locked reconciliation period and can't be re-cleared. Undo the reconciliation first.");
        }
    }
}
