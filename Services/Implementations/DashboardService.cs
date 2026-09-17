using System.Globalization;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
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
    // Division scope: resolved ONCE per request via IDivisionAccessGuard
    // (null = unrestricted fast path). Restricted users see KPIs computed
    // only from their granted divisions plus company-level rows
    // (DivisionId == null) — policy D1.
    //
    // Demo invoices (IsDemo = true) are excluded from EVERY KPI so the
    // FBR Sandbox feature doesn't pollute the home screen — same rule the
    // Bills/Invoices pages already use.

    public class DashboardService : IDashboardService
    {
        private readonly AppDbContext _context;
        private readonly IPermissionService _permissions;
        private readonly IDivisionAccessGuard _divisionAccess;

        public DashboardService(
            AppDbContext context,
            IPermissionService permissions,
            IDivisionAccessGuard divisionAccess)
        {
            _context = context;
            _permissions = permissions;
            _divisionAccess = divisionAccess;
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

            // Division-RBAC scope, resolved once (null = unrestricted).
            // Every section query threads through it; company-level rows
            // (DivisionId == null) stay included — policy D1.
            var divScope = userId.HasValue
                ? await _divisionAccess.GetAccessibleDivisionIdsAsync(userId.Value, companyId)
                : null;

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
                response.Hero = await ComputeHeroAsync(companyId, period, canSales, canPurchases, divScope);

            // Run section queries in parallel — they share an
            // AppDbContext but EF Core 9's pooled context handles
            // sequential awaits cheaply, and the savings only matter
            // for the 4-section case anyway. Sequential here for
            // simplicity and to avoid the "second operation started
            // before previous completed" pitfall on AppDbContext.
            if (canSales)      response.Sales      = await ComputeSalesAsync(companyId, period, divScope);
            if (canPurchases)  response.Purchases  = await ComputePurchasesAsync(companyId, period, divScope);
            if (canFbr)        response.Fbr        = await ComputeFbrAsync(companyId, period, divScope);
            if (canInventory)  response.Inventory  = await ComputeInventoryAsync(companyId, divScope);

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
            int companyId, DashboardPeriod period, bool canSales, bool canPurchases,
            HashSet<int>? divScope)
        {
            var hero = new DashboardHeroKpis();

            if (canSales)
            {
                var (totalSales, gstOutput, salesExTax) = await SumInvoicesAsync(companyId, period.From, period.To, divScope);
                hero.TotalSales = totalSales;
                hero.GstOutput = gstOutput;
                hero.TotalSalesExcludingTax = salesExTax;
                if (period.PreviousFrom.HasValue)
                {
                    var (prevSales, _, _) = await SumInvoicesAsync(companyId, period.PreviousFrom, period.PreviousTo, divScope);
                    hero.TotalSalesPrev = prevSales;
                }
            }

            if (canPurchases)
            {
                var (totalPurchases, gstInput) = await SumPurchasesAsync(companyId, period.From, period.To, divScope);
                hero.TotalPurchases = totalPurchases;
                hero.GstInput = gstInput;
                if (period.PreviousFrom.HasValue)
                {
                    var (prevPurchases, _) = await SumPurchasesAsync(companyId, period.PreviousFrom, period.PreviousTo, divScope);
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
                    var (_, prevGstOutput, _) = await SumInvoicesAsync(companyId, period.PreviousFrom, period.PreviousTo, divScope);
                    var (_, prevGstInput)  = await SumPurchasesAsync(companyId, period.PreviousFrom, period.PreviousTo, divScope);
                    hero.GstNetPrev = prevGstOutput - prevGstInput;
                }
            }

            await FillImporterKpisAsync(hero, companyId, period, divScope);

            return hero;
        }

        /// <summary>
        /// The figures an importer's dashboard actually needs: cost of goods
        /// sold, gross profit, stock on hand, receivables, everything owed, and
        /// what is recoverable from the tax authority — plus the three flags
        /// that decide which cards have anything to say.
        ///
        /// Why this exists: an importer buys nothing on purchase bills (stock
        /// arrives through opening stock and GD costing), so Total Purchases
        /// reads 0 and Net (Sales − Purchases) merely restates Total Sales
        /// while looking like profit. On one company that made a card read
        /// 11.4M next to a rising arrow when real gross profit was −6,195.
        /// </summary>
        private async Task FillImporterKpisAsync(
            DashboardHeroKpis hero, int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            // ── Cost of goods sold, and what stock is left ─────────────────
            // Both come out of ONE walk. The cost of a sale is the weighted
            // average standing at that moment, so the walk has to see the whole
            // history even when the dashboard is showing one week of it.
            var openingRows = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .Select(o => new
                {
                    o.ItemTypeId, o.Quantity, o.ValueExcludingTax,
                    o.ActualCostExcludingTax, o.SalesTaxRate,
                })
                .ToListAsync();

            var movementQuery = _context.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId);
            if (divScope != null)
                movementQuery = movementQuery.Where(m =>
                    m.DivisionId == null || divScope.Contains(m.DivisionId.Value));
            var movements = await movementQuery.ToListAsync();

            var openings = openingRows
                .GroupBy(o => o.ItemTypeId)
                .ToDictionary(
                    g => g.Key,
                    g => new InventoryPeriodConsumption.Opening(
                        g.Sum(x => x.Quantity),
                        g.Sum(x => x.ValueExcludingTax),
                        g.Sum(x => x.ActualCostExcludingTax),
                        g.Max(x => x.SalesTaxRate)));

            var movementsByItem = movements
                .GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());

            hero.HasStock = openings.Count > 0 || movementsByItem.Count > 0;

            if (hero.HasStock)
            {
                // Exact for ANY range, rather than summing whole monthly ledger
                // entries — a part-month view must not inherit a whole month's
                // cost. Same walk as the posting, so a whole-month selection
                // agrees with the ledger by construction.
                var consumed = InventoryPeriodConsumption.ComputeRange(
                    openings, movementsByItem, period.From, period.To);
                hero.CostOfGoodsSold = consumed.CostOfGoodsSold;
                hero.InventoryAdjustments = consumed.Adjustments;

                // Stock on hand is a POSITION, not a flow, so it is never
                // period-scoped: "what is in the warehouse" has no date range.
                // Shared with the Inventory section rather than recomputed, so
                // the two figures on one screen cannot contradict each other.
                hero.StockOnHandValue = await ComputeStockOnHandValueAsync(companyId, divScope);
            }

            hero.GrossProfit = Math.Round(
                hero.TotalSalesExcludingTax - hero.CostOfGoodsSold, 2, MidpointRounding.AwayFromZero);
            hero.GrossMarginPercent = hero.TotalSalesExcludingTax != 0m
                ? Math.Round(hero.GrossProfit / hero.TotalSalesExcludingTax * 100m, 1, MidpointRounding.AwayFromZero)
                : null;

            // ── Receivables ────────────────────────────────────────────────
            // Outstanding is a POSITION too — what is owed now, not what was
            // invoiced in the period — so it is deliberately unfiltered by date.
            var today = DateTime.Now.Date;
            var receivableQuery = _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10
                         && i.GrandTotal > i.AmountPaid);
            if (divScope != null)
                receivableQuery = receivableQuery.Where(i =>
                    i.DivisionId == null || divScope.Contains(i.DivisionId.Value));

            var receivables = await receivableQuery
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Total = g.Sum(i => i.GrandTotal - i.AmountPaid),
                    Overdue = g.Sum(i => i.DueDate != null && i.DueDate < today
                        ? i.GrandTotal - i.AmountPaid
                        : 0m),
                })
                .FirstOrDefaultAsync();
            hero.ReceivablesTotal = receivables?.Total ?? 0m;
            hero.ReceivablesOverdue = receivables?.Overdue ?? 0m;

            // ── Everything owed, and everything recoverable ────────────────
            // Read from the ledger rather than recomputed, so these agree with
            // the balance sheet by construction. A liability sits credit-side,
            // so its balance is negated to read as a positive "owed" figure.
            var balances = await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.IsActive)
                .Select(a => new
                {
                    a.Id,
                    a.ControlType,
                    Opening = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance,
                    Movement = _context.JournalLines
                        .Where(jl => jl.AccountId == a.Id && jl.JournalEntry.CompanyId == companyId)
                        .Sum(jl => (decimal?)(jl.Debit - jl.Credit)) ?? 0m,
                })
                .ToListAsync();

            decimal Owed(params ControlType[] roles)
            {
                var wanted = roles.ToHashSet();
                return Math.Round(
                    -balances.Where(b => wanted.Contains(b.ControlType)).Sum(b => b.Opening + b.Movement),
                    2, MidpointRounding.AwayFromZero);
            }
            decimal Held(params ControlType[] roles)
            {
                var wanted = roles.ToHashSet();
                return Math.Round(
                    balances.Where(b => wanted.Contains(b.ControlType)).Sum(b => b.Opening + b.Movement),
                    2, MidpointRounding.AwayFromZero);
            }

            hero.PayablesTrade = Owed(ControlType.AccountsPayable);
            hero.PayablesTax = Owed(ControlType.OutputTax, ControlType.FurtherTaxPayable,
                                    ControlType.WithholdingPayable);
            hero.PayablesImportClearing = Owed(ControlType.ImportClearing);
            hero.PayablesTotal = Math.Round(
                hero.PayablesTrade + hero.PayablesTax + hero.PayablesImportClearing,
                2, MidpointRounding.AwayFromZero);

            // Input tax and advance income tax on imports are ASSETS, not
            // payables: an import's duties are paid at clearance and credited
            // back afterwards. Zero until a GD is recorded as a New Arrival —
            // a Backfill consignment posts nothing by design — which is exactly
            // when this should start showing.
            hero.RecoverableInputTax = Held(ControlType.InputTax);
            hero.RecoverableAdvanceIncomeTax = Held(ControlType.AdvanceIncomeTaxOnImports);
            hero.RecoverableTaxTotal = Math.Round(
                hero.RecoverableInputTax + hero.RecoverableAdvanceIncomeTax,
                2, MidpointRounding.AwayFromZero);

            // ── Which cards have anything to say ───────────────────────────
            hero.HasPurchases = await _context.PurchaseBills.AsNoTracking()
                .AnyAsync(p => p.CompanyId == companyId);
            hero.HasAnyActivity = hero.HasStock
                || hero.HasPurchases
                || hero.TotalSales != 0m
                || hero.ReceivablesTotal != 0m
                || await _context.Invoices.AsNoTracking()
                        .AnyAsync(i => i.CompanyId == companyId && !i.IsDemo);
        }

        /// <summary>
        /// What the goods on hand are worth, from the weighted-average walk —
        /// the SAME figure the stock dashboard and the ledger's Inventory
        /// account use.
        ///
        /// The Inventory section used to derive this from purchase-bill lines
        /// alone, so an importer (who has none, and whose stock arrives as
        /// opening balances and GD costing) saw Rs 0 on the same screen as a
        /// Stock on Hand card reading 6,990,121. One source, so they cannot
        /// disagree again.
        /// </summary>
        private async Task<decimal> ComputeStockOnHandValueAsync(int companyId, HashSet<int>? divScope)
        {
            var openingRows = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .Select(o => new
                {
                    o.ItemTypeId, o.Quantity, o.ValueExcludingTax,
                    o.ActualCostExcludingTax, o.SalesTaxRate,
                })
                .ToListAsync();

            var movementQuery = _context.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId);
            if (divScope != null)
                movementQuery = movementQuery.Where(m =>
                    m.DivisionId == null || divScope.Contains(m.DivisionId.Value));
            var movements = await movementQuery.ToListAsync();

            var openings = openingRows
                .GroupBy(o => o.ItemTypeId)
                .ToDictionary(
                    g => g.Key,
                    g => new InventoryPeriodConsumption.Opening(
                        g.Sum(x => x.Quantity),
                        g.Sum(x => x.ValueExcludingTax),
                        g.Sum(x => x.ActualCostExcludingTax),
                        g.Max(x => x.SalesTaxRate)));

            var movementsByItem = movements
                .GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());

            decimal total = 0m;
            foreach (var (itemTypeId, open) in openings)
                if (!movementsByItem.ContainsKey(itemTypeId))
                    total += open.ValueExcludingTax;   // never moved
            foreach (var (itemTypeId, itemMovements) in movementsByItem)
            {
                openings.TryGetValue(itemTypeId, out var open);
                var position = StockValuation.Compute(
                    open.Quantity, open.ValueExcludingTax, open.ActualCostExcludingTax,
                    open.SalesTaxRate, itemMovements);
                total += position.ValueExcludingTax;
            }
            return Math.Round(total, 2, MidpointRounding.AwayFromZero);
        }

        private async Task<(decimal TotalGross, decimal GstAmount, decimal Subtotal)> SumInvoicesAsync(
            int companyId, DateTime? from, DateTime? to, HashSet<int>? divScope)
        {
            var q = _context.Invoices
                .AsNoTracking()
                // Debit/Credit Notes (DocumentType 9/10) are REVERSALS, not
                // sales — including them would double-count a reversed sale
                // instead of netting it. Excluded from every sales KPI.
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10);
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            if (from.HasValue) q = q.Where(i => i.Date >= from.Value);
            if (to.HasValue)   q = q.Where(i => i.Date < to.Value);
            var agg = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    TotalGross = g.Sum(i => i.GrandTotal),
                    GstAmount  = g.Sum(i => i.GSTAmount),
                    // Ex-tax, so the dashboard can show the figure a stock
                    // sheet is actually comparable to.
                    Subtotal   = g.Sum(i => i.Subtotal),
                })
                .FirstOrDefaultAsync();
            return (agg?.TotalGross ?? 0m, agg?.GstAmount ?? 0m, agg?.Subtotal ?? 0m);
        }

        private async Task<(decimal TotalGross, decimal GstAmount)> SumPurchasesAsync(
            int companyId, DateTime? from, DateTime? to, HashSet<int>? divScope)
        {
            var q = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId);
            if (divScope != null)
                q = q.Where(pb => pb.DivisionId == null || divScope.Contains(pb.DivisionId.Value));
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

        private async Task<DashboardSalesKpis> ComputeSalesAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            var q = _context.Invoices
                .AsNoTracking()
                // Debit/Credit Notes (DocumentType 9/10) are REVERSALS, not
                // sales — including them would double-count a reversed sale
                // instead of netting it. Excluded from every sales KPI.
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10);
            // Division-RBAC scope (null = unrestricted); company-level rows
            // (DivisionId == null) stay visible — policy D1.
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
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
            //
            // 2026-05-13: roll up by ClientGroupId so two Client rows
            // representing the same legal entity (e.g. one per tenant
            // in the Common Clients group) collapse into one dashboard
            // row. Pre-fix, Roshan Traders' dashboard showed "MEKO
            // DENIM MILLS (Pvt) Ltd." twice — once for ClientId=8
            // (Roshan's own row) and once for ClientId=5 (Hakimi's row,
            // reachable via a cross-tenant invoice link); both rows
            // share ClientGroupId=8, so the group key is the right
            // identity.
            //
            // Fallback: legacy rows still nullable on ClientGroupId use
            // -ClientId as the partition key (negative space never
            // collides with positive group ids).
            var topClients = await q
                .GroupBy(i => i.Client!.ClientGroupId ?? -i.ClientId)
                .Select(g => new DashboardTopEntity
                {
                    Id = g.Min(x => x.ClientId),
                    // Every row in a real ClientGroup carries the same
                    // master Name (group sync keeps them aligned). Max
                    // is just a deterministic picker.
                    Name = g.Max(x => x.Client!.Name) ?? "(unknown)",
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
                Trend12m = await Trend12mInvoicesAsync(companyId, divScope),
                TopClients = topClients,
                RecentInvoices = recent,
            };
        }

        // 12-point monthly trend always shows the last 12 months of data
        // regardless of the operator's selected period — gives a stable
        // visual axis. Anchored on the first of the current month.
        private async Task<List<DashboardTrendPoint>> Trend12mInvoicesAsync(
            int companyId, HashSet<int>? divScope)
        {
            var now = DateTime.Now;
            var anchor = new DateTime(now.Year, now.Month, 1);
            var earliest = anchor.AddMonths(-11);  // 12 buckets total

            var q = _context.Invoices
                .AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10
                         && i.Date >= earliest && i.Date < anchor.AddMonths(1));
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));

            var rows = await q
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

        private async Task<DashboardPurchaseKpis> ComputePurchasesAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            var q = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId);
            // Division-RBAC scope (null = unrestricted); company-level rows
            // (DivisionId == null) stay visible — policy D1.
            if (divScope != null)
                q = q.Where(pb => pb.DivisionId == null || divScope.Contains(pb.DivisionId.Value));
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

            // Same SupplierGroup roll-up as the Clients side above —
            // see that comment for context.
            var topSuppliers = await q
                .GroupBy(pb => pb.Supplier!.SupplierGroupId ?? -pb.SupplierId)
                .Select(g => new DashboardTopEntity
                {
                    Id = g.Min(x => x.SupplierId),
                    Name = g.Max(x => x.Supplier!.Name) ?? "(unknown)",
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
                Trend12m = await Trend12mPurchasesAsync(companyId, divScope),
                TopSuppliers = topSuppliers,
                RecentBills = recent,
            };
        }

        private async Task<List<DashboardTrendPoint>> Trend12mPurchasesAsync(
            int companyId, HashSet<int>? divScope)
        {
            var now = DateTime.Now;
            var anchor = new DateTime(now.Year, now.Month, 1);
            var earliest = anchor.AddMonths(-11);

            var q = _context.PurchaseBills
                .AsNoTracking()
                .Where(pb => pb.CompanyId == companyId
                          && pb.Date >= earliest && pb.Date < anchor.AddMonths(1));
            if (divScope != null)
                q = q.Where(pb => pb.DivisionId == null || divScope.Contains(pb.DivisionId.Value));

            var rows = await q
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

        private async Task<DashboardFbrKpis> ComputeFbrAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            var q = _context.Invoices
                .AsNoTracking()
                // Debit/Credit Notes (DocumentType 9/10) are REVERSALS, not
                // sales — including them would double-count a reversed sale
                // instead of netting it. Excluded from every sales KPI.
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10);
            // Division-RBAC scope (null = unrestricted); company-level rows
            // (DivisionId == null) stay visible — policy D1.
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
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
            if (divScope != null)
                pbq = pbq.Where(pb => pb.DivisionId == null || divScope.Contains(pb.DivisionId.Value));
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

        private async Task<DashboardInventoryKpis> ComputeInventoryAsync(
            int companyId, HashSet<int>? divScope)
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

            // Shared scoped base for the three movement queries below.
            // Division-RBAC scope (null = unrestricted); movements stamped
            // from company-level documents (DivisionId == null) stay
            // visible — policy D1.
            var movementsQ = _context.StockMovements
                .AsNoTracking()
                .Where(sm => sm.CompanyId == companyId);
            if (divScope != null)
                movementsQ = movementsQ.Where(sm => sm.DivisionId == null || divScope.Contains(sm.DivisionId.Value));

            var perItemMovements = await movementsQ
                .GroupBy(sm => sm.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    OnHand = g.Sum(sm => sm.Direction == StockMovementDirection.In ? sm.Quantity : -sm.Quantity),
                })
                .ToListAsync();

            // Opening balances are company-level (not division-scoped — policy
            // D1) and are the base of on-hand. Fix 2026-07 (PR-16): the KPI
            // previously summed movements ONLY, so it disagreed with the Stock
            // Dashboard (StockService.GetOnHandBulkAsync includes openings) for
            // any company with opening balances. Merge them here so the two
            // agree, and so an item with only an opening balance still counts.
            var openingsByItem = await _context.OpeningStockBalances
                .AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Qty);

            var onHandByItem = new Dictionary<int, decimal>();
            foreach (var m in perItemMovements) onHandByItem[m.ItemTypeId] = m.OnHand;
            foreach (var o in openingsByItem)
                onHandByItem[o.Key] = onHandByItem.GetValueOrDefault(o.Key) + o.Value;

            // Average cost per item — pull from PurchaseItems for items
            // that have purchases. Items without any purchases get cost=0
            // (stock value contribution = 0 — fine, they're typically
            // pre-existing inventory adjustments).
            var costsQ = _context.PurchaseItems
                .AsNoTracking()
                .Where(pi => pi.PurchaseBill.CompanyId == companyId && pi.ItemTypeId.HasValue && pi.Quantity > 0);
            // Cost basis rides on the parent bill's division tag — scope it
            // the same way so a restricted user's stock value derives only
            // from bills they can see.
            if (divScope != null)
                costsQ = costsQ.Where(pi => pi.PurchaseBill.DivisionId == null || divScope.Contains(pi.PurchaseBill.DivisionId.Value));
            var perItemCosts = await costsQ
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

            // Valued by the same walk as the hero's Stock on Hand card, so the
            // two figures on one screen cannot contradict each other.
            decimal totalStockValue = await ComputeStockOnHandValueAsync(companyId, divScope);
            int trackedItemCount = 0;
            int lowStockCount = 0;
            foreach (var kv in onHandByItem)
            {
                var onHand = kv.Value;
                trackedItemCount++;
                if (onHand <= 0) lowStockCount++;
                _ = costMap;   // retained for the low-stock/cost drill-downs below
            }

            // Top 5 items by movement volume in the last 30 days — most
            // useful "what's actually moving" signal. SourceType doesn't
            // matter here (purchases or sales — anything that moves
            // stock counts as movement).
            var thirty = DateTime.Now.AddDays(-30);
            var topItems = await movementsQ
                .Where(sm => sm.MovementDate >= thirty)
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

            var recentMovements = await movementsQ
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
