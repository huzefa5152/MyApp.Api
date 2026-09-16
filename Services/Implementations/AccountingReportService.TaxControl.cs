using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// The tax control report — the one report here that deliberately computes
    /// the same figure twice, from two different tables, by two different
    /// routes:
    ///
    ///   • PER LEDGER — the control account's movement in the window.
    ///   • PER DOCUMENTS — the same tax summed off the invoices and bills.
    ///
    /// A report that only reads the ledger cannot tell you the ledger is wrong.
    /// These two agreeing is the check; the difference column is what an
    /// operator looks at before filing a return on these numbers.
    ///
    /// This is also where keeping further tax OUT of Output Sales Tax earns its
    /// keep: because it has its own account, Output Sales Tax still reconciles
    /// to GST on sales, and a further-tax mistake shows up on its own row
    /// instead of quietly widening the sales-tax difference.
    /// </summary>
    public partial class AccountingReportService
    {
        /// <summary>A sales document reduced to the taxes on it. Named rather
        /// than anonymous so the sign helper below can take it by type.</summary>
        private sealed record SalesTaxRow(
            int? DocumentType, decimal GstAmount, decimal FurtherTaxAmount, decimal WithholdingTaxAmount);

        public async Task<TaxControlDto> GetTaxControlAsync(int companyId, DateTime? from, DateTime? to)
        {
            var dto = new TaxControlDto { From = from?.Date, To = to?.Date };

            var accounts = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.ControlType != ControlType.None)
                .Select(a => new { a.Id, a.Name, a.ControlType })
                .ToListAsync();
            var movement = await MovementAsync(companyId, from, to);

            // ── the document side ──
            // Notes carry the opposite sign of the sale they adjust, so a credit
            // note reduces output tax exactly as it reduced the sale. Demo and
            // cancelled bills are excluded here for the same reason the posting
            // engine never books them.
            var sales = await _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && (from == null || i.Date >= from.Value.Date)
                         && (to == null || i.Date <= to.Value.Date))
                .Select(i => new SalesTaxRow(
                    i.DocumentType, i.GSTAmount, i.FurtherTaxAmount, i.WithholdingTaxAmount))
                .ToListAsync();

            decimal SalesSum(Func<SalesTaxRow, decimal> pick) =>
                sales.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * pick(i));

            var purchases = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId
                         && (from == null || b.Date >= from.Value.Date)
                         && (to == null || b.Date <= to.Value.Date))
                .Select(b => new { b.GSTAmount, b.WithholdingTaxAmount })
                .ToListAsync();

            var perDocuments = new Dictionary<ControlType, decimal>
            {
                [ControlType.OutputTax] = SalesSum(i => i.GstAmount),
                [ControlType.FurtherTaxPayable] = SalesSum(i => i.FurtherTaxAmount),
                [ControlType.WithholdingReceivable] = SalesSum(i => i.WithholdingTaxAmount),
                [ControlType.InputTax] = purchases.Sum(b => b.GSTAmount),
                [ControlType.WithholdingPayable] = purchases.Sum(b => b.WithholdingTaxAmount),
            };

            // Which side each role sits on, so both columns can be compared as
            // plain positive amounts instead of one being signed and the other
            // not. Tax we OWE is a credit; tax we can RECLAIM is a debit.
            var isDebitSide = new HashSet<ControlType>
            {
                ControlType.InputTax,
                ControlType.WithholdingReceivable,
            };

            foreach (var role in new[]
            {
                ControlType.OutputTax,
                ControlType.FurtherTaxPayable,
                ControlType.InputTax,
                ControlType.WithholdingReceivable,
                ControlType.WithholdingPayable,
            })
            {
                var account = accounts.FirstOrDefault(a => a.ControlType == role);
                var signed = account == null ? 0m : movement.GetValueOrDefault(account.Id);
                var perLedger = isDebitSide.Contains(role) ? signed : -signed;
                var perDocs = perDocuments.GetValueOrDefault(role);

                dto.Rows.Add(new TaxControlRowDto
                {
                    Role = role.ToString(),
                    AccountId = account?.Id,
                    AccountName = account?.Name ?? "(no account on the chart)",
                    PerLedger = perLedger,
                    PerDocuments = perDocs,
                    Difference = perLedger - perDocs,
                    Reconciles = perLedger == perDocs,
                });
            }

            dto.AllReconcile = dto.Rows.All(r => r.Reconciles);
            return dto;
        }
    }
}
