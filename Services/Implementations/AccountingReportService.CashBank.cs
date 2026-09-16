using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>The cash book: what each bank and cash account opened at, what
    /// moved through it, and what it closed at.</summary>
    public partial class AccountingReportService
    {
        public async Task<CashBookDto> GetCashBookAsync(int companyId, DateTime? from, DateTime? to)
        {
            var dto = new CashBookDto { From = from?.Date, To = to?.Date };

            // Which accounts count as money. Same two-armed test the picker
            // uses: the control flag, or an asset account sitting in a group
            // named for bank or cash — an imported chart often has the group and
            // not the flag, and a bank account missing from the cash book is a
            // reconciliation that can never be finished.
            var groupIsMoney = await _context.AccountGroups.AsNoTracking()
                .Where(g => g.CompanyId == companyId)
                .Select(g => new { g.Id, g.Name })
                .ToDictionaryAsync(g => g.Id, g => (g.Name ?? "").ToLowerInvariant());

            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.AccountType == AccountType.Asset)
                .Select(a => new { a.Id, a.Name, a.Code, a.ControlType, a.AccountGroupId, a.Position })
                .OrderBy(a => a.Position).ThenBy(a => a.Id)
                .ToListAsync();

            var moneyAccounts = accounts
                .Where(a => a.ControlType == ControlType.BankCash
                         || (groupIsMoney.TryGetValue(a.AccountGroupId, out var n)
                             && (n.Contains("bank") || n.Contains("cash"))))
                .ToList();
            if (moneyAccounts.Count == 0) return dto;

            var ids = moneyAccounts.Select(a => a.Id).ToList();

            // The opening position is the ledger's own balance as at the day
            // BEFORE the window — not a sum of lines computed here, so the cash
            // book and the chart cannot drift apart.
            var opening = from.HasValue
                ? await _gl.GetAccountBalancesAsync(companyId, from.Value.Date.AddDays(-1))
                : new Dictionary<int, decimal>();
            // With no From, the opening is the account's own opening balance —
            // everything else is movement inside the window.
            var openingBalances = from.HasValue
                ? opening
                : await _context.Accounts.AsNoTracking()
                    .Where(a => ids.Contains(a.Id))
                    .Select(a => new { a.Id, Signed = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance })
                    .ToDictionaryAsync(a => a.Id, a => a.Signed);

            var movement = await _context.JournalLines.AsNoTracking()
                .Where(l => ids.Contains(l.AccountId)
                         && l.JournalEntry.CompanyId == companyId
                         && (from == null || l.JournalEntry.Date >= from.Value.Date)
                         && (to == null || l.JournalEntry.Date <= to.Value.Date))
                .GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, In = g.Sum(x => x.Debit), Out = g.Sum(x => x.Credit) })
                .ToDictionaryAsync(x => x.AccountId, x => new { x.In, x.Out });

            foreach (var a in moneyAccounts)
            {
                var mv = movement.GetValueOrDefault(a.Id);
                var open = openingBalances.GetValueOrDefault(a.Id);
                var moneyIn = mv?.In ?? 0m;
                var moneyOut = mv?.Out ?? 0m;
                // Drop an account that neither holds nor moved anything — a
                // cash book padded with empty accounts hides the real ones.
                if (open == 0m && moneyIn == 0m && moneyOut == 0m) continue;

                dto.Accounts.Add(new CashBookAccountDto
                {
                    AccountId = a.Id,
                    Name = a.Name,
                    Code = a.Code,
                    Opening = open,
                    MoneyIn = moneyIn,
                    MoneyOut = moneyOut,
                    Closing = open + moneyIn - moneyOut,
                });
            }

            dto.Opening = dto.Accounts.Sum(a => a.Opening);
            dto.MoneyIn = dto.Accounts.Sum(a => a.MoneyIn);
            dto.MoneyOut = dto.Accounts.Sum(a => a.MoneyOut);
            dto.Closing = dto.Accounts.Sum(a => a.Closing);
            return dto;
        }
    }
}
