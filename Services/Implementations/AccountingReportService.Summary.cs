using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// The accounting dashboard (Dashboards → Accounting). Same rule as
    /// <see cref="GetDashboardAsync"/>: every ledger figure is the total of a
    /// report that can be opened in full, taken FROM that report rather than
    /// recomputed, so the dashboard and the report behind a card can never
    /// disagree. The receipt, payment and cheque figures are read straight off
    /// the payment subledger, which is what those registers read too.
    /// </summary>
    public partial class AccountingReportService
    {
        public async Task<AccountingSummaryDto> GetSummaryAsync(int companyId, DateTime? from, DateTime? to)
        {
            await using var ledgerRead = await _context.LedgerReadScopeAsync();

            var today = PakistanClock.Today;
            var periodFrom = (from ?? new DateTime(today.Year, today.Month, 1)).Date;
            var periodTo = (to ?? today).Date;
            if (periodFrom > periodTo) (periodFrom, periodTo) = (periodTo, periodFrom);

            var status = await _gl.GetStatusAsync(companyId);
            var summary = new AccountingSummaryDto
            {
                From = periodFrom,
                To = periodTo,
                GlEnabled = status.Enabled,
                Ledger = status,
            };

            // Cash & bank: the cash book's closing per account at the period
            // end. No From, so the closing is the whole history to that date.
            var cash = await GetCashBookAsync(companyId, null, periodTo);
            summary.CashAccounts = cash.Accounts
                .Select(a => new CashAccountBalanceDto
                {
                    AccountId = a.AccountId,
                    Name = a.Name,
                    Code = a.Code,
                    Balance = a.Closing,
                })
                .OrderByDescending(a => a.Balance)
                .ToList();
            summary.CashAndBankTotal = cash.Closing;

            // Profitability for the period.
            var pl = await GetProfitAndLossAsync(companyId, periodFrom, periodTo);
            summary.Income = pl.TotalIncome;
            summary.Expenses = pl.TotalExpenses;
            summary.NetProfit = pl.NetProfit;

            // Working capital, aged as at the period end — the aged reports'
            // own totals (demo, cancelled and notes are excluded there).
            summary.Receivables = Buckets(await GetAgedReceivablesAsync(companyId, periodTo));
            summary.Payables = Buckets(await GetAgedPayablesAsync(companyId, periodTo));

            // Tax positions, per the ledger.
            var tax = await GetTaxControlAsync(companyId, periodFrom, periodTo);
            decimal Tax(string role) => tax.Rows.FirstOrDefault(r => r.Role == role)?.PerLedger ?? 0m;
            summary.OutputTax = Tax(nameof(ControlType.OutputTax));
            summary.InputTax = Tax(nameof(ControlType.InputTax));
            summary.FurtherTaxPayable = Tax(nameof(ControlType.FurtherTaxPayable));
            summary.WithholdingReceivable = Tax(nameof(ControlType.WithholdingReceivable));
            summary.WithholdingPayable = Tax(nameof(ControlType.WithholdingPayable));

            // Money moved in the period. A voided document keeps its number but
            // moves nothing, so it is left out — as the registers leave it out.
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

            // Cheques written but not yet cleared (pending or deposited),
            // whenever they were written — an outstanding cheque is exposure
            // until it clears or bounces, whatever period is on screen.
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

            summary.RecentReceipts = await RecentMoneyDocsAsync(companyId, PaymentDirection.Receipt);
            summary.RecentPayments = await RecentMoneyDocsAsync(companyId, PaymentDirection.Payment);
            return summary;
        }

        private static SummaryAgingBucketsDto Buckets(AgedReportDto r) => new()
        {
            Total = r.Total,
            Current = r.Current,
            Days1To30 = r.Days1To30,
            Days31To60 = r.Days31To60,
            Days61To90 = r.Days61To90,
            Over90 = r.Over90,
        };

        /// <summary>The five latest non-void receipts or payments. Party names
        /// are looked up inside the company — ContactId is a soft reference, so
        /// an unscoped lookup could print another tenant's name.</summary>
        private async Task<List<RecentMoneyDocDto>> RecentMoneyDocsAsync(int companyId, PaymentDirection direction)
        {
            var prefix = direction == PaymentDirection.Receipt ? "RCP" : "PMT";
            var rows = await _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && p.Direction == direction && !p.IsCancelled)
                .OrderByDescending(p => p.Date).ThenByDescending(p => p.Number)
                .Take(5)
                .Select(p => new { p.Id, p.Number, p.Date, p.Amount, p.Description, p.ContactType, p.ContactId, p.ContactName })
                .ToListAsync();

            var clientIds = rows.Where(r => r.ContactType == "Client" && r.ContactId.HasValue)
                .Select(r => r.ContactId!.Value).Distinct().ToList();
            var supplierIds = rows.Where(r => r.ContactType == "Supplier" && r.ContactId.HasValue)
                .Select(r => r.ContactId!.Value).Distinct().ToList();
            var clientNames = clientIds.Count > 0
                ? await _context.Clients.AsNoTracking()
                    .Where(c => c.CompanyId == companyId && clientIds.Contains(c.Id))
                    .ToDictionaryAsync(c => c.Id, c => c.Name)
                : new Dictionary<int, string>();
            var supplierNames = supplierIds.Count > 0
                ? await _context.Suppliers.AsNoTracking()
                    .Where(s => s.CompanyId == companyId && supplierIds.Contains(s.Id))
                    .ToDictionaryAsync(s => s.Id, s => s.Name)
                : new Dictionary<int, string>();

            return rows.Select(r => new RecentMoneyDocDto
            {
                Id = r.Id,
                Reference = $"{prefix}-{r.Number:D4}",
                Date = r.Date,
                Amount = r.Amount,
                Description = r.Description,
                ContactName = (r.ContactType == "Client" ? clientNames.GetValueOrDefault(r.ContactId ?? 0)
                             : r.ContactType == "Supplier" ? supplierNames.GetValueOrDefault(r.ContactId ?? 0)
                             : null) ?? r.ContactName,
            }).ToList();
        }
    }
}
