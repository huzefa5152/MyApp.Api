using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    // ── Dashboard service ───────────────────────────────────────────────
    //
    // One-shot KPI aggregator for /api/dashboard/kpis.
    //
    // Permission-shaped: each section is null on the wire when the caller
    // doesn't hold the matching dashboard.kpi.*.view permission. We resolve
    // the user's permission set ONCE up front and then short-circuit per
    // section — that keeps both the SQL chatter (no queries for sections
    // we won't return) and the response payload (no money numbers leak)
    // tight.
    //
    // Tenant scope: every query filters by companyId. The controller has
    // already validated that the caller belongs to that company; we trust
    // that and don't re-check.
    //
    // Demo invoices (IsDemo = true) are excluded from EVERY KPI so the
    // FBR Sandbox feature doesn't pollute the home screen — same rule the
    // Bills/Invoices pages already use.

    public class DashboardService : IDashboardService
    {
        private readonly AppDbContext _context;
        private readonly IPermissionService _permissions;

        public DashboardService(AppDbContext context, IPermissionService permissions)
        {
            _context = context;
            _permissions = permissions;
        }

        public async Task<DashboardKpisResponse> GetKpisAsync(
            int companyId, string periodCode, ClaimsPrincipal user)
        {
            var userId = ResolveUserId(user);
            // Pull the whole permission set once. `GetUserPermissionsAsync`
            // returns the union of every permission granted via every role
            // the user holds — single DB call, then in-memory checks.
            var perms = userId.HasValue
                ? await _permissions.GetUserPermissionsAsync(userId.Value)
                : (IReadOnlyCollection<string>)Array.Empty<string>();

            bool canSales      = perms.Contains("dashboard.kpi.sales.view");
            bool canPurchases  = perms.Contains("dashboard.kpi.purchases.view");
            bool canFbr        = perms.Contains("dashboard.kpi.fbr.view");
            bool canInventory  = perms.Contains("dashboard.kpi.inventory.view");
            bool canHero       = canSales || canPurchases;  // Hero needs ≥1 of these

            var period = BuildPeriod(periodCode);
            var company = await _context.Companies
                .Where(c => c.Id == companyId)
                .Select(c => new { c.Id, c.Name })
                .FirstOrDefaultAsync();

            var response = new DashboardKpisResponse
            {
                CompanyId = companyId,
                CompanyName = company?.Name ?? "",
                Period = period,
                Permissions = new DashboardPermissionFlags
                {
                    CanViewSales = canSales,
                    CanViewPurchases = canPurchases,
                    CanViewFbr = canFbr,
                    CanViewInventory = canInventory,
                },
            };

            // Hero band is the first thing the eye lands on. We compute
            // it whenever the operator can see EITHER sales or purchases
            // (so a sales-only role still sees Total Sales as a hero
            // KPI; we just zero out the sections they can't see).
            if (canHero)
                response.Hero = await ComputeHeroAsync(companyId, period, canSales, canPurchases);

            // Run section queries in parallel — they share an
            // AppDbContext but EF Core 9's pooled context handles
            // sequential awaits cheaply, and the savings only matter
            // for the 4-section case anyway. Sequential here for
            // simplicity and to avoid the "second operation started
            // before previous completed" pitfall on AppDbContext.
            if (canSales)      response.Sales      = await ComputeSalesAsync(companyId, period);
            if (canPurchases)  response.Purchases  = await ComputePurchasesAsync(companyId, period);
            if (canFbr)        response.Fbr        = await ComputeFbrAsync(companyId, period);
            if (canInventory)  response.Inventory  = await ComputeInventoryAsync(companyId);

            return response;
        }

        // ── Period resolution ───────────────────────────────────────────

        private static DashboardPeriod BuildPeriod(string code)
        {
            // Reference "now" in local time (server-side wall clock).
            // We don't try to honour the operator's timezone here — the
            // tax calendar is calendar-month based on Pakistan time and
            // the server runs there. If you ever multi-region this,
            // pull tz from Company.
            var now = DateTime.Now;
            var today = now.Date;

            DateTime? from = null, to = null, prevFrom = null, prevTo = null;
            string label = "All Time";
            var c = (code ?? "").ToLowerInvariant();

            switch (c)
            {
                case "this-week":
                {
                    label = "This Week";
                    var monday = today.AddDays(-(int)today.DayOfWeek + (today.DayOfWeek == DayOfWeek.Sunday ? -6 : 1));
                    from = monday;
                    to = monday.AddDays(7);
                    prevFrom = monday.AddDays(-7);
                    prevTo = monday;
                    break;
                }
                case "last-week":
                {
                    label = "Last Week";
                    var thisMonday = today.AddDays(-(int)today.DayOfWeek + (today.DayOfWeek == DayOfWeek.Sunday ? -6 : 1));
                    from = thisMonday.AddDays(-7);
                    to = thisMonday;
                    prevFrom = thisMonday.AddDays(-14);
                    prevTo = thisMonday.AddDays(-7);
                    break;
                }
                case "this-month":
                {
                    label = "This Month";
                    var firstOfMonth = new DateTime(today.Year, today.Month, 1);
                    from = firstOfMonth;
                    to = firstOfMonth.AddMonths(1);
                    prevFrom = firstOfMonth.AddMonths(-1);
                    prevTo = firstOfMonth;
                    break;
                }
                case "last-month":
                {
                    label = "Last Month";
                    var firstOfThisMonth = new DateTime(today.Year, today.Month, 1);
                    from = firstOfThisMonth.AddMonths(-1);
                    to = firstOfThisMonth;
                    prevFrom = firstOfThisMonth.AddMonths(-2);
                    prevTo = firstOfThisMonth.AddMonths(-1);
                    break;
                }
                case "this-year":
                {
                    label = "This Year";
                    var firstOfYear = new DateTime(today.Year, 1, 1);
                    from = firstOfYear;
                    to = firstOfYear.AddYears(1);
                    prevFrom = firstOfYear.AddYears(-1);
                    prevTo = firstOfYear;
                    break;
                }
                case "last-year":
                {
                    label = "Last Year";
                    var firstOfThisYear = new DateTime(today.Year, 1, 1);
                    from = firstOfThisYear.AddYears(-1);
                    to = firstOfThisYear;
                    prevFrom = firstOfThisYear.AddYears(-2);
                    prevTo = firstOfThisYear.AddYears(-1);
                    break;
                }
                case "all-time":
                default:
                {
                    label = "All Time";
                    // No date filter; no previous-period delta.
                    break;
                }
            }

            return new DashboardPeriod
            {
                Code = string.IsNullOrEmpty(c) ? "all-time" : c,
                Label = label,
                From = from,
                To = to,
                PreviousFrom = prevFrom,
                PreviousTo = prevTo,
            };
        }

        // ── Hero KPIs ───────────────────────────────────────────────────

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
                .Where(i => i.CompanyId == companyId && !i.IsDemo);
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

        private async Task<DashboardSalesKpis> ComputeSalesAsync(int companyId, DashboardPeriod period)
        {
            var q = _context.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo);
            if (period.From.HasValue) q = q.Where(i => i.Date >= period.From.Value);
            if (period.To.HasValue)   q = q.Where(i => i.Date < period.To.Value);

            var aggregate = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Total = g.Sum(i => i.GrandTotal),
                    Count = g.Count(),
                })
                .FirstOrDefaultAsync();

            var totalSales = aggregate?.Total ?? 0m;
            var count = aggregate?.Count ?? 0;
            var avg = count > 0 ? totalSales / count : 0m;

            // Top 5 clients within the period — by gross sales value.
            var topClients = await q
                .GroupBy(i => new { i.ClientId, i.Client!.Name })
                .Select(g => new DashboardTopEntity
                {
                    Id = g.Key.ClientId,
                    Name = g.Key.Name ?? "(unknown)",
                    Value = g.Sum(i => i.GrandTotal),
                    Count = g.Count(),
                })
                .OrderByDescending(x => x.Value)
                // Bumped from 5 → 20 — the dashboard donut groups
                // anything beyond the top 8 into "Others" but the
                // detail list shows all 20 with exact numbers.
                .Take(20)
                .ToListAsync();

            // Recent 5 within the period (most recent first).
            var recent = await q
                .OrderByDescending(i => i.Date)
                .Take(5)
                .Select(i => new DashboardRecentBill
                {
                    Id = i.Id,
                    Number = i.InvoiceNumber,
                    Date = i.Date,
                    CounterpartyName = i.Client!.Name ?? "",
                    GrandTotal = i.GrandTotal,
                    Status = i.FbrStatus,
                })
                .ToListAsync();

            return new DashboardSalesKpis
            {
                TotalSales = totalSales,
                InvoiceCount = count,
                AverageInvoiceValue = Math.Round(avg, 2),
                Trend12m = await Trend12mInvoicesAsync(companyId),
                TopClients = topClients,
                RecentInvoices = recent,
            };
        }

        // 12-point monthly trend always shows the last 12 months of data
        // regardless of the operator's selected period — gives a stable
        // visual axis. Anchored on the first of the current month.
        private async Task<List<DashboardTrendPoint>> Trend12mInvoicesAsync(int companyId)
        {
            var now = DateTime.Now;
            var anchor = new DateTime(now.Year, now.Month, 1);
            var earliest = anchor.AddMonths(-11);  // 12 buckets total

            var rows = await _context.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo
                         && i.Date >= earliest && i.Date < anchor.AddMonths(1))
                .GroupBy(i => new { i.Date.Year, i.Date.Month })
                .Select(g => new
                {
                    g.Key.Year,
                    g.Key.Month,
                    Value = g.Sum(i => i.GrandTotal),
                })
                .ToListAsync();

            return BuildTrend12m(anchor, rows.Select(r => (r.Year, r.Month, r.Value)));
        }

        // ── Purchases section ───────────────────────────────────────────

        private async Task<DashboardPurchaseKpis> ComputePurchasesAsync(int companyId, DashboardPeriod period)
        {
            var q = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId);
            if (period.From.HasValue) q = q.Where(pb => pb.Date >= period.From.Value);
            if (period.To.HasValue)   q = q.Where(pb => pb.Date < period.To.Value);

            var aggregate = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Total = g.Sum(pb => pb.GrandTotal),
                    Count = g.Count(),
                })
                .FirstOrDefaultAsync();

            var totalPurchases = aggregate?.Total ?? 0m;
            var count = aggregate?.Count ?? 0;
            var avg = count > 0 ? totalPurchases / count : 0m;

            var topSuppliers = await q
                .GroupBy(pb => new { pb.SupplierId, pb.Supplier!.Name })
                .Select(g => new DashboardTopEntity
                {
                    Id = g.Key.SupplierId,
                    Name = g.Key.Name ?? "(unknown)",
                    Value = g.Sum(pb => pb.GrandTotal),
                    Count = g.Count(),
                })
                .OrderByDescending(x => x.Value)
                // Bumped from 5 → 20 — the dashboard donut groups
                // anything beyond the top 8 into "Others" but the
                // detail list shows all 20 with exact numbers.
                .Take(20)
                .ToListAsync();

            var recent = await q
                .OrderByDescending(pb => pb.Date)
                .Take(5)
                .Select(pb => new DashboardRecentBill
                {
                    Id = pb.Id,
                    Number = pb.PurchaseBillNumber,
                    Date = pb.Date,
                    CounterpartyName = pb.Supplier!.Name ?? "",
                    GrandTotal = pb.GrandTotal,
                    Status = pb.ReconciliationStatus,
                })
                .ToListAsync();

            return new DashboardPurchaseKpis
            {
                TotalPurchases = totalPurchases,
                BillCount = count,
                AverageBillValue = Math.Round(avg, 2),
                Trend12m = await Trend12mPurchasesAsync(companyId),
                TopSuppliers = topSuppliers,
                RecentBills = recent,
            };
        }

        private async Task<List<DashboardTrendPoint>> Trend12mPurchasesAsync(int companyId)
        {
            var now = DateTime.Now;
            var anchor = new DateTime(now.Year, now.Month, 1);
            var earliest = anchor.AddMonths(-11);

            var rows = await _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId
                          && pb.Date >= earliest && pb.Date < anchor.AddMonths(1))
                .GroupBy(pb => new { pb.Date.Year, pb.Date.Month })
                .Select(g => new
                {
                    g.Key.Year,
                    g.Key.Month,
                    Value = g.Sum(pb => pb.GrandTotal),
                })
                .ToListAsync();

            return BuildTrend12m(anchor, rows.Select(r => (r.Year, r.Month, r.Value)));
        }

        // Shared trend-bucketing — fills missing months with 0 so the
        // sparkline has a continuous 12-point axis even when the
        // operator hasn't billed something every month.
        private static List<DashboardTrendPoint> BuildTrend12m(
            DateTime anchor,
            IEnumerable<(int Year, int Month, decimal Value)> rows)
        {
            var byKey = rows.ToDictionary(r => (r.Year, r.Month), r => r.Value);
            var trend = new List<DashboardTrendPoint>(12);
            for (int i = 11; i >= 0; i--)
            {
                var dt = anchor.AddMonths(-i);
                byKey.TryGetValue((dt.Year, dt.Month), out var value);
                trend.Add(new DashboardTrendPoint
                {
                    Month = dt.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                    Label = dt.ToString("MMM yy", CultureInfo.InvariantCulture),
                    Value = value,
                });
            }
            return trend;
        }

        // ── FBR / Compliance section ────────────────────────────────────

        private async Task<DashboardFbrKpis> ComputeFbrAsync(int companyId, DashboardPeriod period)
        {
            var q = _context.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo);
            if (period.From.HasValue) q = q.Where(i => i.Date >= period.From.Value);
            if (period.To.HasValue)   q = q.Where(i => i.Date < period.To.Value);

            // Single round-trip — group by FbrStatus, then bucket in
            // memory. Five buckets max so this is cheap.
            var byStatus = await q
                .GroupBy(i => i.FbrStatus ?? "")
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();

            var pending   = byStatus.Where(x => x.Status != "Submitted" && x.Status != "Validated" && x.Status != "Failed").Sum(x => x.Count);
            var validated = byStatus.Where(x => x.Status == "Validated").Sum(x => x.Count);
            var submitted = byStatus.Where(x => x.Status == "Submitted").Sum(x => x.Count);
            var failed    = byStatus.Where(x => x.Status == "Failed").Sum(x => x.Count);

            var excluded = await q.CountAsync(i => i.IsFbrExcluded);

            // Reconciliation funnel — same period filter applied to
            // PurchaseBills' ReconciliationStatus column. Tracks how
            // well buyer-side bills line up with FBR Annexure-A.
            var pbq = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId);
            if (period.From.HasValue) pbq = pbq.Where(pb => pb.Date >= period.From.Value);
            if (period.To.HasValue)   pbq = pbq.Where(pb => pb.Date < period.To.Value);

            var reconCounts = await pbq
                .GroupBy(pb => pb.ReconciliationStatus ?? "")
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();

            return new DashboardFbrKpis
            {
                PendingSubmission = pending,
                Validated = validated,
                Submitted = submitted,
                Failed = failed,
                Excluded = excluded,
                ReconciliationPending  = reconCounts.FirstOrDefault(x => x.Status == "Pending")?.Count ?? 0,
                ReconciliationMatched  = reconCounts.FirstOrDefault(x => x.Status == "Matched")?.Count ?? 0,
                ReconciliationDisputed = reconCounts.FirstOrDefault(x => x.Status == "Disputed")?.Count ?? 0,
            };
        }

        // ── Inventory section ───────────────────────────────────────────

        private async Task<DashboardInventoryKpis> ComputeInventoryAsync(int companyId)
        {
            // Stock value at cost = Σ (on-hand × avg unit cost). Heavy if
            // we computed it per-item with N+1; instead we do it as a
            // single grouped query against StockMovements + a join into
            // PurchaseItems for the cost basis.
            //
            // On-hand per item:  Σ (qty × (Direction == In ? 1 : -1))
            // Avg unit cost:     Σ (PurchaseItem.LineTotal) / Σ Quantity for that item
            //
            // Both per-item, then summed over all items in the company.
            // We do it in two queries (cheap) and join in memory.

            var perItemMovements = await _context.StockMovements
                .AsNoTracking()
                .Where(sm => sm.CompanyId == companyId)
                .GroupBy(sm => sm.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    OnHand = g.Sum(sm => sm.Direction == StockMovementDirection.In ? sm.Quantity : -sm.Quantity),
                })
                .ToListAsync();

            // Average cost per item — pull from PurchaseItems for items
            // that have purchases. Items without any purchases get cost=0
            // (stock value contribution = 0 — fine, they're typically
            // pre-existing inventory adjustments).
            var perItemCosts = await _context.PurchaseItems
                .AsNoTracking()
                .Where(pi => pi.PurchaseBill.CompanyId == companyId && pi.ItemTypeId.HasValue && pi.Quantity > 0)
                .GroupBy(pi => pi.ItemTypeId!.Value)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    TotalCost = g.Sum(pi => pi.LineTotal),
                    TotalQty  = g.Sum(pi => pi.Quantity),
                })
                .ToListAsync();

            var costMap = perItemCosts.ToDictionary(x => x.ItemTypeId,
                x => x.TotalQty > 0 ? x.TotalCost / x.TotalQty : 0m);

            decimal totalStockValue = 0m;
            int trackedItemCount = 0;
            int lowStockCount = 0;
            foreach (var m in perItemMovements)
            {
                trackedItemCount++;
                if (m.OnHand <= 0) lowStockCount++;
                if (costMap.TryGetValue(m.ItemTypeId, out var avgCost))
                    totalStockValue += m.OnHand * avgCost;
            }

            // Top 5 items by movement volume in the last 30 days — most
            // useful "what's actually moving" signal. SourceType doesn't
            // matter here (purchases or sales — anything that moves
            // stock counts as movement).
            var thirty = DateTime.Now.AddDays(-30);
            var topItems = await _context.StockMovements
                .AsNoTracking()
                .Where(sm => sm.CompanyId == companyId && sm.MovementDate >= thirty)
                .GroupBy(sm => new { sm.ItemTypeId, sm.ItemType!.Name })
                .Select(g => new DashboardTopEntity
                {
                    Id = g.Key.ItemTypeId,
                    Name = g.Key.Name ?? "(unknown)",
                    Value = g.Sum(sm => sm.Quantity),  // total movement qty
                    Count = g.Count(),                 // number of movements
                })
                .OrderByDescending(x => x.Value)
                // Bumped from 5 → 20 — the dashboard donut groups
                // anything beyond the top 8 into "Others" but the
                // detail list shows all 20 with exact numbers.
                .Take(20)
                .ToListAsync();

            var recentMovements = await _context.StockMovements
                .AsNoTracking()
                .Where(sm => sm.CompanyId == companyId)
                .OrderByDescending(sm => sm.MovementDate)
                .Take(5)
                .Select(sm => new DashboardRecentMovement
                {
                    Id = sm.Id,
                    Date = sm.MovementDate,
                    ItemTypeName = sm.ItemType!.Name ?? "(unknown)",
                    Direction = sm.Direction == StockMovementDirection.In ? "In" : "Out",
                    Quantity = sm.Quantity,
                    SourceType = sm.SourceType.ToString(),
                })
                .ToListAsync();

            return new DashboardInventoryKpis
            {
                TotalStockValue = Math.Round(totalStockValue, 2),
                TrackedItemCount = trackedItemCount,
                LowStockItemCount = lowStockCount,
                TopItemsByMovement = topItems,
                RecentMovements = recentMovements,
            };
        }

        // ── Helpers ─────────────────────────────────────────────────────

        private static int? ResolveUserId(ClaimsPrincipal user)
        {
            var raw = user.FindFirstValue(JwtRegisteredClaimNames.Sub)
                   ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(raw, out var id) ? id : (int?)null;
        }
    }
}
