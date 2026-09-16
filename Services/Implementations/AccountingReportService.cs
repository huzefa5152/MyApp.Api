using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Core of the accounting reports: the shared plumbing and the two
    /// statements. The rest lives in partials beside this file — Parties,
    /// CashBank, TaxControl — split by subject rather than by size, so a change
    /// to how a party ledger reads never has to be made in a 2,000-line file.
    ///
    /// See <see cref="IAccountingReportService"/> for the rule every method
    /// here follows: read the ledger, reuse the ledger's primitives, invent
    /// nothing.
    /// </summary>
    public partial class AccountingReportService : IAccountingReportService
    {
        private readonly AppDbContext _context;
        private readonly IGeneralLedgerService _gl;

        public AccountingReportService(AppDbContext context, IGeneralLedgerService gl)
        {
            _context = context;
            _gl = gl;
        }

        /// <summary>Which statement an account type belongs to.</summary>
        private static bool IsProfitAndLoss(AccountType t) =>
            t == AccountType.Income || t == AccountType.Expense;

        /// <summary>Credit-normal types read positive in their natural sign, so
        /// the ledger's debit-positive figure is flipped for them — in this one
        /// helper, so no report can flip it a second time.</summary>
        private static decimal Natural(AccountType t, decimal signedDebitPositive) =>
            t is AccountType.Liability or AccountType.Equity or AccountType.Income
                ? -signedDebitPositive
                : signedDebitPositive;

        private sealed record AccountRow(int Id, string? Code, string Name, AccountType Type, string GroupName, int Position);

        private async Task<List<AccountRow>> LoadAccountsAsync(int companyId) =>
            await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId)
                .OrderBy(a => a.Position).ThenBy(a => a.Id)
                .Select(a => new AccountRow(a.Id, a.Code, a.Name, a.AccountType, a.AccountGroup.Name, a.Position))
                .ToListAsync();

        /// <summary>Movement per account inside a window, signed debit-positive.
        /// The one query every windowed report uses.</summary>
        private async Task<Dictionary<int, decimal>> MovementAsync(int companyId, DateTime? from, DateTime? to) =>
            await _context.JournalLines.AsNoTracking()
                .Where(l => l.JournalEntry.CompanyId == companyId
                         && (from == null || l.JournalEntry.Date >= from.Value.Date)
                         && (to == null || l.JournalEntry.Date <= to.Value.Date))
                .GroupBy(l => l.AccountId)
                .Select(g => new { AccountId = g.Key, Net = g.Sum(x => x.Debit - x.Credit) })
                .ToDictionaryAsync(x => x.AccountId, x => x.Net);

        /// <summary>Groups the lines of one statement section by account group,
        /// dropping whatever is zero — a statement page of zeroes buries the
        /// figures that matter.</summary>
        private static List<StatementSectionDto> BuildSections(
            IEnumerable<AccountRow> accounts, Func<AccountRow, decimal> amount)
        {
            var sections = new List<StatementSectionDto>();
            foreach (var group in accounts.GroupBy(a => a.GroupName))
            {
                var section = new StatementSectionDto { Name = group.Key };
                foreach (var a in group)
                {
                    var v = amount(a);
                    if (v == 0m) continue;
                    section.Lines.Add(new StatementLineDto
                    {
                        AccountId = a.Id,
                        Code = a.Code,
                        Name = a.Name,
                        AccountType = a.Type.ToString(),
                        GroupName = a.GroupName,
                        Amount = v,
                    });
                }
                section.Total = section.Lines.Sum(l => l.Amount);
                if (section.Lines.Count > 0) sections.Add(section);
            }
            return sections;
        }

        // ── Balance sheet ─────────────────────────────────────────────────────

        public async Task<BalanceSheetDto> GetBalanceSheetAsync(int companyId, DateTime? asOf)
        {
            var at = (asOf ?? DateTime.UtcNow).Date;
            var accounts = await LoadAccountsAsync(companyId);
            // The ledger's own primitive, not a sum of our own: opening balance
            // plus every movement up to the date.
            var balances = await _gl.GetAccountBalancesAsync(companyId, at);

            decimal Signed(AccountRow a) => balances.GetValueOrDefault(a.Id);
            decimal Show(AccountRow a) => Natural(a.Type, Signed(a));

            var dto = new BalanceSheetDto { AsOf = at };
            dto.Assets = BuildSections(accounts.Where(a => a.Type == AccountType.Asset), Show);
            dto.Liabilities = BuildSections(accounts.Where(a => a.Type == AccountType.Liability), Show);
            dto.Equity = BuildSections(accounts.Where(a => a.Type == AccountType.Equity), Show);

            dto.TotalAssets = dto.Assets.Sum(s => s.Total);
            dto.TotalLiabilities = dto.Liabilities.Sum(s => s.Total);

            // The period's earnings are not on any equity account yet — income
            // and expense carry them — so they are rolled in here as their own
            // line. Without it a balance sheet with any trading on it never
            // foots, which operators read as "the software is broken".
            var plSigned = accounts.Where(a => IsProfitAndLoss(a.Type)).Sum(Signed);
            dto.CurrentEarnings = -plSigned;   // a profit is a net credit
            dto.TotalEquity = dto.Equity.Sum(s => s.Total) + dto.CurrentEarnings;

            dto.IsBalanced = dto.TotalAssets == dto.TotalLiabilities + dto.TotalEquity;
            return dto;
        }

        // ── Profit and loss ───────────────────────────────────────────────────

        public async Task<ProfitAndLossDto> GetProfitAndLossAsync(int companyId, DateTime? from, DateTime? to)
        {
            var accounts = await LoadAccountsAsync(companyId);
            // A P&L is a WINDOW, not a position: it reports movement in the
            // period and never the account's opening balance, which belongs to
            // an earlier year's result.
            var movement = await MovementAsync(companyId, from, to);

            decimal Show(AccountRow a) => Natural(a.Type, movement.GetValueOrDefault(a.Id));

            var dto = new ProfitAndLossDto { From = from?.Date, To = to?.Date };
            dto.Income = BuildSections(accounts.Where(a => a.Type == AccountType.Income), Show);
            dto.Expenses = BuildSections(accounts.Where(a => a.Type == AccountType.Expense), Show);
            dto.TotalIncome = dto.Income.Sum(s => s.Total);
            dto.TotalExpenses = dto.Expenses.Sum(s => s.Total);
            dto.NetProfit = dto.TotalIncome - dto.TotalExpenses;
            return dto;
        }

        // ── Expenses ──────────────────────────────────────────────────────────

        public async Task<ExpenseReportDto> GetExpenseReportAsync(int companyId, DateTime? from, DateTime? to)
        {
            var accounts = await LoadAccountsAsync(companyId);
            var movement = await MovementAsync(companyId, from, to);

            var dto = new ExpenseReportDto { From = from?.Date, To = to?.Date };
            foreach (var a in accounts.Where(a => a.Type == AccountType.Expense))
            {
                var amount = Natural(a.Type, movement.GetValueOrDefault(a.Id));
                if (amount == 0m) continue;
                dto.Rows.Add(new ExpenseRowDto
                {
                    AccountId = a.Id,
                    Name = a.Name,
                    GroupName = a.GroupName,
                    Amount = amount,
                });
            }
            dto.Total = dto.Rows.Sum(r => r.Amount);
            // Percentages are for reading, not for arithmetic — they are derived
            // from the totals above and nothing is derived from them.
            if (dto.Total != 0m)
                foreach (var r in dto.Rows)
                    r.Percent = Math.Round(r.Amount / dto.Total * 100m, 2, MidpointRounding.AwayFromZero);
            dto.Rows = dto.Rows.OrderByDescending(r => r.Amount).ToList();
            return dto;
        }

        // ── Dashboard ─────────────────────────────────────────────────────────

        public async Task<AccountingDashboardDto> GetDashboardAsync(int companyId, DateTime? from, DateTime? to)
        {
            // Every figure is the total of a report that can be opened in full,
            // taken FROM that report rather than recomputed — so the dashboard
            // and the report it summarises can never disagree.
            var pl = await GetProfitAndLossAsync(companyId, from, to);
            var cash = await GetCashBookAsync(companyId, from, to);
            var ar = await GetAgedReceivablesAsync(companyId, to);
            var ap = await GetAgedPayablesAsync(companyId, to);
            var tax = await GetTaxControlAsync(companyId, from, to);
            var status = await _gl.GetStatusAsync(companyId);

            decimal Tax(string role) => tax.Rows.FirstOrDefault(r => r.Role == role)?.PerLedger ?? 0m;

            return new AccountingDashboardDto
            {
                From = from?.Date,
                To = to?.Date,
                Income = pl.TotalIncome,
                Expenses = pl.TotalExpenses,
                NetProfit = pl.NetProfit,
                CashAndBank = cash.Closing,
                Receivables = ar.Total,
                Payables = ap.Total,
                OutputTax = Tax(nameof(ControlType.OutputTax)),
                InputTax = Tax(nameof(ControlType.InputTax)),
                FurtherTaxPayable = Tax(nameof(ControlType.FurtherTaxPayable)),
                WithholdingReceivable = Tax(nameof(ControlType.WithholdingReceivable)),
                WithholdingPayable = Tax(nameof(ControlType.WithholdingPayable)),
                JournalEntries = status.EntryCount,
                LedgerBalances = status.IsBalanced,
            };
        }
    }
}
