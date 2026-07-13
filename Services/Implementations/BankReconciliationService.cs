using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Bank reconciliation read model (BANK_RECONCILIATION_DESIGN.md §4.2–4.3).
    ///
    /// Actual balance is the GL balance (already computed by AccountService via the
    /// GL). Pending buckets are summed from the subledger — receipts/payments (by
    /// their resolved bank account) and transfers (by leg) that have no
    /// ReconciledDate. Cleared is then DERIVED: Cleared = Actual − PendingDeposits +
    /// PendingWithdrawals. Nothing here posts or moves money; the GL is untouched.
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

        public async Task<List<BankAccountReconSummaryDto>> GetAccountSummariesAsync(int companyId)
        {
            // Actual balances come from the same source the screen already shows.
            var accounts = await _accounts.GetBankCashAccountsAsync(companyId);
            if (accounts.Count == 0) return new List<BankAccountReconSummaryDto>();

            // Payments with no explicit BankAccountId post to the lowest-id BankCash
            // control account (mirror of PostingService.ResolveAsync) — attribute
            // their pending amounts to the same account so the identity holds.
            var defaultBankId = accounts
                .Where(a => a.ControlType == "BankCash")
                .OrderBy(a => a.Id)
                .Select(a => (int?)a.Id)
                .FirstOrDefault() ?? accounts.OrderBy(a => a.Id).First().Id;

            var valid = accounts.Select(a => a.Id).ToHashSet();
            var pendingDeposits = accounts.ToDictionary(a => a.Id, _ => 0m);
            var pendingWithdrawals = accounts.ToDictionary(a => a.Id, _ => 0m);

            // Uncleared receipts/payments (skip cancelled — they move no money).
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

            // Uncleared transfers — Dr receiving (deposit), Cr paying (withdrawal).
            var transfers = await _context.AccountTransfers.AsNoTracking()
                .Where(t => t.CompanyId == companyId && t.ReconciledDate == null)
                .Select(t => new { t.FromAccountId, t.ToAccountId, t.Amount })
                .ToListAsync();
            foreach (var t in transfers)
            {
                if (valid.Contains(t.ToAccountId)) pendingDeposits[t.ToAccountId] += t.Amount;
                if (valid.Contains(t.FromAccountId)) pendingWithdrawals[t.FromAccountId] += t.Amount;
            }

            return accounts.Select(a =>
            {
                var pd = pendingDeposits.GetValueOrDefault(a.Id);
                var pw = pendingWithdrawals.GetValueOrDefault(a.Id);
                return new BankAccountReconSummaryDto
                {
                    AccountId = a.Id,
                    Name = a.Name,
                    Code = a.Code,
                    ActualBalance = a.Balance,
                    ClearedBalance = a.Balance - pd + pw,
                    PendingDeposits = pd,
                    PendingWithdrawals = pw,
                };
            }).ToList();
        }

        public async Task<bool> SetPaymentClearedAsync(int paymentId, bool cleared, DateTime? clearedDate)
        {
            var p = await _context.Payments.FirstOrDefaultAsync(x => x.Id == paymentId);
            if (p == null) return false;
            p.ReconciledDate = cleared ? (clearedDate ?? p.Date) : null;
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<bool> SetTransferClearedAsync(int transferId, bool cleared, DateTime? clearedDate)
        {
            var t = await _context.AccountTransfers.FirstOrDefaultAsync(x => x.Id == transferId);
            if (t == null) return false;
            t.ReconciledDate = cleared ? (clearedDate ?? t.Date) : null;
            await _context.SaveChangesAsync();
            return true;
        }
    }
}
