using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
public sealed class LegacyDashboardHeroQuery(AppDbContext context) {
private readonly AppDbContext _context=context;
public Task<DashboardHeroKpis> ExecuteAsync(int id,DashboardPeriod period,bool sales,bool purchases)=>ComputeHeroAsync(id,period,sales,purchases);
        private async Task<DashboardHeroKpis> ComputeHeroAsync(
            int companyId, DashboardPeriod period, bool canSales, bool canPurchases)
        {
            var hero = new DashboardHeroKpis();

            if (canSales)
            {
                var (totalSales, gstOutput) = await SumInvoicesAsync(companyId, period.From, period.To);
                hero.TotalSales = totalSales;
                hero.GstOutput = gstOutput;
                if (period.PreviousFrom.HasValue)
                {
                    var (prevSales, _) = await SumInvoicesAsync(companyId, period.PreviousFrom, period.PreviousTo);
                    hero.TotalSalesPrev = prevSales;
                }
            }

            if (canPurchases)
            {
                var (totalPurchases, gstInput) = await SumPurchasesAsync(companyId, period.From, period.To);
                hero.TotalPurchases = totalPurchases;
                hero.GstInput = gstInput;
                if (period.PreviousFrom.HasValue)
                {
                    var (prevPurchases, _) = await SumPurchasesAsync(companyId, period.PreviousFrom, period.PreviousTo);
                    hero.TotalPurchasesPrev = prevPurchases;
                }
            }

            hero.Net = hero.TotalSales - hero.TotalPurchases;
            hero.GstNet = hero.GstOutput - hero.GstInput;
            if (hero.TotalSalesPrev.HasValue || hero.TotalPurchasesPrev.HasValue)
            {
                hero.NetPrev = (hero.TotalSalesPrev ?? 0m) - (hero.TotalPurchasesPrev ?? 0m);
                // GstNetPrev only meaningful when we computed both prev
                // sums — leave null when we computed only one side.
                if (canSales && canPurchases)
                {
                    var (_, prevGstOutput) = await SumInvoicesAsync(companyId, period.PreviousFrom, period.PreviousTo);
                    var (_, prevGstInput)  = await SumPurchasesAsync(companyId, period.PreviousFrom, period.PreviousTo);
                    hero.GstNetPrev = prevGstOutput - prevGstInput;
                }
            }

            return hero;
        }

        private async Task<(decimal TotalGross, decimal GstAmount)> SumInvoicesAsync(
            int companyId, DateTime? from, DateTime? to)
        {
            var q = _context.Invoices
                .AsNoTracking()
                // Debit/Credit Notes (DocumentType 9/10) are REVERSALS, not
                // sales — including them would double-count a reversed sale
                // instead of netting it. Excluded from every sales KPI.
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10);
            if (from.HasValue) q = q.Where(i => i.Date >= from.Value);
            if (to.HasValue)   q = q.Where(i => i.Date < to.Value);
            var agg = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    TotalGross = g.Sum(i => i.GrandTotal),
                    GstAmount  = g.Sum(i => i.GSTAmount),
                })
                .FirstOrDefaultAsync();
            return (agg?.TotalGross ?? 0m, agg?.GstAmount ?? 0m);
        }

        private async Task<(decimal TotalGross, decimal GstAmount)> SumPurchasesAsync(
            int companyId, DateTime? from, DateTime? to)
        {
            var q = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId);
            if (from.HasValue) q = q.Where(pb => pb.Date >= from.Value);
            if (to.HasValue)   q = q.Where(pb => pb.Date < to.Value);
            var agg = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    TotalGross = g.Sum(pb => pb.GrandTotal),
                    GstAmount  = g.Sum(pb => pb.GSTAmount),
                })
                .FirstOrDefaultAsync();
            return (agg?.TotalGross ?? 0m, agg?.GstAmount ?? 0m);
        }

        // ── Sales section ───────────────────────────────────────────────

}
