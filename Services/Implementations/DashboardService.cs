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
        private readonly IGeneralLedgerService _gl;
        private readonly IImportTaxWorksheetService _worksheet;
        // One request, one walk: the hero and the monthly series share the load.
        private readonly Dictionary<string, PositionInputs> _inputsCache = new();

        public DashboardService(
            AppDbContext context,
            IPermissionService permissions,
            IDivisionAccessGuard divisionAccess,
            IGeneralLedgerService gl,
            IImportTaxWorksheetService worksheet)
        {
            _gl = gl;
            _worksheet = worksheet;
            _context = context;
            _permissions = permissions;
            _divisionAccess = divisionAccess;
        }

        public async Task<DashboardKpisResponse> GetKpisAsync(
            int companyId, string periodCode, DateTime? from, DateTime? to, ClaimsPrincipal user)
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

            var period = BuildPeriod(periodCode, from, to);
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
            if (canSales)      response.Monthly    = await ComputeMonthlyAsync(companyId, period, divScope);
            if (canSales)      response.Sales      = await ComputeSalesAsync(companyId, period, divScope);
            if (canPurchases)  response.Purchases  = await ComputePurchasesAsync(companyId, period, divScope);
            if (canFbr)        response.Fbr        = await ComputeFbrAsync(companyId, period, divScope);
            if (canInventory)  response.Inventory  = await ComputeInventoryAsync(companyId, divScope);

            response.Health = await ComputeHealthAsync(companyId, period, canSales, response.Hero, divScope);
            return response;
        }

        // ── Monthly series ──────────────────────────────────────────────

        private static DateTime MonthStart(DateTime d) => new(d.Year, d.Month, 1);

        /// <summary>Twelve months ending at the period's end month (never past
        /// today): net sales and landed cost of sales from the same filter and
        /// the same stock walk the hero uses, cut at each month.</summary>
        private async Task<List<DashboardMonthPoint>> ComputeMonthlyAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            var todayM = MonthStart(PakistanClock.Today);
            var last = period.To.HasValue ? MonthStart(period.To.Value.AddDays(-1)) : todayM;
            if (last > todayM) last = todayM;
            var first = last.AddMonths(-11);
            var end = last.AddMonths(1);

            var q = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, first, end);
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            var sales = (await q
                .GroupBy(i => new { i.Date.Year, i.Date.Month })
                .Select(g => new { g.Key.Year, g.Key.Month, Net = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.Subtotal) })
                .ToListAsync())
                .ToDictionary(x => new DateTime(x.Year, x.Month, 1), x => x.Net);

            var inputs = await LoadPositionInputsAsync(companyId, divScope);
            var hasStock = inputs.Openings.Count > 0 || inputs.MovementsByItem.Count > 0;

            var points = new List<DashboardMonthPoint>();
            for (var m = first; m <= last; m = m.AddMonths(1))
            {
                var net = Round(sales.GetValueOrDefault(m));
                var landed = hasStock
                    ? Round(ItemStockPositions.Compute(inputs.Openings, inputs.MovementsByItem, inputs.Names,
                        m, m.AddMonths(1), inputs.Costing).Sum(p => p.ConsumedLanded))
                    : 0m;
                points.Add(new DashboardMonthPoint
                {
                    Month = m.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                    NetSales = net,
                    LandedCost = landed,
                    MarginPct = net != 0m ? Math.Round((net - landed) / net * 100m, 1, MidpointRounding.AwayFromZero) : null,
                });
            }
            return points;
        }

        // ── Tax position (Payable to FBR) ───────────────────────────────

        public async Task<(DashboardTaxPositionDto? Dto, string? Refusal)> GetTaxPositionAsync(
            int companyId, string periodCode, DateTime? from, DateTime? to, ClaimsPrincipal user)
        {
            var (ctx, refusal) = await LoadTaxPositionAsync(companyId, periodCode, from, to, user);
            return (ctx?.Dto, refusal);
        }

        private sealed record TaxDoc(int Year, int Month, decimal Sign, decimal GSTAmount,
            decimal FurtherTaxAmount, decimal AdvanceTaxAmount, string? AdvanceTaxSection);

        /// <summary>The panel plus what it was built from, so the tax drill-downs
        /// read the same window and documents rather than recomputing them.</summary>
        private sealed record TaxContext(DashboardTaxPositionDto Dto, DateTime First, DateTime End, List<TaxDoc> Docs);

        private static readonly ControlType[] TaxGlRoles = { ControlType.InputTax, ControlType.WithholdingPayable };

        /// <summary>The journal lines the panel's GL figures come from.</summary>
        private IQueryable<JournalLine> TaxGlLines(int companyId, DateTime first, DateTime end, ControlType[] roles) =>
            _context.JournalLines.AsNoTracking()
                .Where(jl => jl.JournalEntry.CompanyId == companyId && jl.Account.CompanyId == companyId
                          && jl.JournalEntry.Date >= first && jl.JournalEntry.Date < end
                          && roles.Contains(jl.Account.ControlType));

        private async Task<(TaxContext? Ctx, string? Refusal)> LoadTaxPositionAsync(
            int companyId, string periodCode, DateTime? from, DateTime? to, ClaimsPrincipal user)
        {
            // Same gate as the Sales section of the Overview: output tax, further
            // tax and 236G/H are sales figures, so dashboard.view alone is not enough.
            var userId = ResolveUserId(user) ?? 0;
            var perms = await _permissions.GetUserPermissionsAsync(userId);
            if (!perms.Contains("dashboard.kpi.sales.view"))
                return (null, "You do not have access to the tax position.");

            // Company-wide only, like the Import Tax Desk: a partial return
            // would read as the whole one.
            if (await _divisionAccess.GetAccessibleDivisionIdsAsync(userId, companyId) != null)
                return (null, "The tax position is company-wide only.");

            // The worksheet is by claim MONTH, so the whole panel is read over
            // whole months and says which (FromMonth / ToMonth).
            var period = BuildPeriod(periodCode, from, to);
            var todayM = MonthStart(PakistanClock.Today);
            var last = period.To.HasValue ? MonthStart(period.To.Value.AddDays(-1)) : todayM;
            if (last > todayM) last = todayM;
            var first = period.From.HasValue ? MonthStart(period.From.Value) : last.AddMonths(-35);
            if (first > last) first = last;
            if ((last.Year - first.Year) * 12 + last.Month - first.Month >= 36) first = last.AddMonths(-35);
            var end = last.AddMonths(1);

            var dto = new DashboardTaxPositionDto
            {
                FromMonth = first.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                ToMonth = last.ToString("yyyy-MM", CultureInfo.InvariantCulture),
            };

            // Sales-side figures: the common sale filter, notes signed. (Credit
            // notes are DocumentType 10 here; the worksheet tests NoteKind == 2
            // for the same documents.)
            var docs = await DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, first, end)
                .Select(i => new TaxDoc(i.Date.Year, i.Date.Month, i.DocumentType == 10 ? -1m : 1m,
                    i.GSTAmount, i.FurtherTaxAmount, i.AdvanceTaxAmount, i.AdvanceTaxSection))
                .ToListAsync();
            dto.OutputTax = Round(docs.Sum(d => d.Sign * d.GSTAmount));
            dto.FurtherTax = Round(docs.Sum(d => d.Sign * d.FurtherTaxAmount));
            dto.Adv236G = Round(docs.Where(d => d.AdvanceTaxSection == "236G").Sum(d => d.Sign * d.AdvanceTaxAmount));
            dto.Adv236H = Round(docs.Where(d => d.AdvanceTaxSection == "236H").Sum(d => d.Sign * d.AdvanceTaxAmount));

            // GL figures (zero when the ledger is off).
            dto.LedgerEnabled = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => c.GlPostingEnabled).FirstOrDefaultAsync();
            var glLines = new List<(DateTime Month, ControlType Role, decimal Net)>();
            if (dto.LedgerEnabled)
            {
                // Journal entries have no void / posted state, so (like
                // GeneralLedgerService.GetAccountBalancesAsync) every line counts.
                glLines = (await TaxGlLines(companyId, first, end, TaxGlRoles)
                    .Select(jl => new { jl.JournalEntry.Date, jl.Account.ControlType, jl.Debit, jl.Credit })
                    .ToListAsync())
                    .Select(x => (new DateTime(x.Date.Year, x.Date.Month, 1), x.ControlType, x.Debit - x.Credit))
                    .ToList();
                dto.WhtPayable = Round(-glLines.Where(l => l.Role == ControlType.WithholdingPayable).Sum(l => l.Net));

                var balances = await _gl.GetAccountBalancesAsync(companyId, end.AddDays(-1));
                var roleOf = await _context.Accounts.AsNoTracking()
                    .Where(a => a.CompanyId == companyId
                             && (a.ControlType == ControlType.AdvanceIncomeTaxOnImports || a.ControlType == ControlType.WithholdingReceivable))
                    .Select(a => new { a.Id, a.ControlType }).ToListAsync();
                dto.RecoverableImportAdvanceTax = Round(roleOf.Where(a => a.ControlType == ControlType.AdvanceIncomeTaxOnImports)
                    .Sum(a => balances.GetValueOrDefault(a.Id)));
                dto.RecoverableWhtDeducted = Round(roleOf.Where(a => a.ControlType == ControlType.WithholdingReceivable)
                    .Sum(a => balances.GetValueOrDefault(a.Id)));
            }

            // Input tax: the Import Tax Desk worksheet on FIFO companies (never
            // recomputed here); the ledger's InputTax movement otherwise.
            InputTaxWorksheetDto? sheet = null;
            if (await StockCostingMethod.IsGdFifoAsync(_context, companyId))
            {
                var (error, built) = await _worksheet.BuildAsync(companyId, dto.FromMonth, dto.ToMonth);
                if (error == null) sheet = built;
            }

            var inputByMonth = new Dictionary<DateTime, decimal>();
            if (sheet != null)
            {
                dto.InputBasis = "worksheet";
                foreach (var m in sheet.Months) inputByMonth[MonthStart(m.Month)] = m.InputThisMonth;
                dto.InputTaxClaimed = Round(sheet.Months.Sum(m => m.InputThisMonth));
                dto.SalesTaxPayable = Round(sheet.Months.Sum(m => m.Payable));
            }
            else
            {
                dto.InputBasis = "gl-before-cap";
                foreach (var g in glLines.Where(l => l.Role == ControlType.InputTax).GroupBy(l => l.Month))
                    inputByMonth[g.Key] = Round(g.Sum(l => l.Net));
                dto.InputTaxClaimed = Round(inputByMonth.Values.Sum());
                dto.SalesTaxPayable = Math.Max(0m, Round(dto.OutputTax + dto.FurtherTax - dto.InputTaxClaimed));
            }

            dto.TotalPayable = Round(dto.SalesTaxPayable + dto.Adv236G + dto.Adv236H + dto.WhtPayable);

            for (var m = first; m <= last; m = m.AddMonths(1))
            {
                var inMonth = docs.Where(d => d.Year == m.Year && d.Month == m.Month).ToList();
                dto.Months.Add(new DashboardTaxMonth
                {
                    Month = m.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                    OutputTax = Round(inMonth.Sum(d => d.Sign * d.GSTAmount)),
                    FurtherTax = Round(inMonth.Sum(d => d.Sign * d.FurtherTaxAmount)),
                    Adv236 = Round(inMonth.Where(d => d.AdvanceTaxSection == "236G" || d.AdvanceTaxSection == "236H")
                        .Sum(d => d.Sign * d.AdvanceTaxAmount)),
                    InputTax = Round(inputByMonth.GetValueOrDefault(m)),
                });
            }
            return (new TaxContext(dto, first, end, docs), null);
        }

        // ── Period resolution ───────────────────────────────────────────

        private static DashboardPeriod BuildPeriod(string code, DateTime? customFrom = null, DateTime? customTo = null)
        {
            // Reference "now" in local time (server-side wall clock).
            // We don't try to honour the operator's timezone here — the
            // tax calendar is calendar-month based on Pakistan time and
            // the server runs there. If you ever multi-region this,
            // pull tz from Company.
            var today = PakistanClock.Today;

            DateTime? from = null, to = null, prevFrom = null, prevTo = null;
            string label = "All Time";
            var c = (code ?? "").ToLowerInvariant();
            if (customFrom.HasValue && customTo.HasValue)
            {
                // Custom range: dates are inclusive on the wire, To is stored
                // exclusive like every other period. The previous period is
                // the same number of days immediately before it.
                c = "custom";
                from = customFrom.Value.Date;
                to = customTo.Value.Date.AddDays(1);
                var span = to.Value - from.Value;
                prevFrom = from.Value - span;
                prevTo = from;
                label = from.Value.ToString("dd MMM yyyy") + " – " + customTo.Value.ToString("dd MMM yyyy");
                c = "custom";
            }
            else switch (c)
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
                hero.NetSales = salesExTax;
                hero.SalesInclTax = totalSales;
                if (period.PreviousFrom.HasValue)
                {
                    var (prevSales, _, prevNet) = await SumInvoicesAsync(companyId, period.PreviousFrom, period.PreviousTo, divScope);
                    hero.TotalSalesPrev = prevSales;
                    hero.NetSalesPrev = prevNet;
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

            hero.GstNet = hero.GstOutput - hero.GstInput;
            if (hero.TotalSalesPrev.HasValue || hero.TotalPurchasesPrev.HasValue)
            {
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
            // Cost of goods sold, and what stock is left, from ONE walk over the
            // whole history (see LoadPositionsAsync).
            var positions = await LoadPositionsAsync(companyId, divScope, period.From, period.To);
            hero.HasStock = positions.Count > 0;

            if (hero.HasStock)
            {
                // Period figures: what left, and what it cost on each basis.
                hero.CostOfGoodsSold = Round(positions.Sum(p => p.ConsumedDeclared));
                hero.InventoryAdjustments = Round(positions.Sum(p => p.AdjustmentsDeclared));
                hero.LandedCostOfSales = Round(positions.Sum(p => p.ConsumedLanded));
                hero.UncostedItemCount = positions.Count(p => p.SoldQuantity > 0m && p.ConsumedLanded == 0m);

                // Positions, never period-scoped: "what is in the warehouse"
                // has no date range.
                hero.StockOnHandValue = Round(positions.Sum(p => p.ClosingDeclared));
                hero.StockOnHandLanded = Round(positions.Sum(p => p.ClosingLanded));

                // Dead stock — bought and never sold. The most actionable
                // number here: on this line it reaches 82% of stock.
                var dead = positions.Where(p => p.NeverSold && p.ClosingDeclared > 0m).ToList();
                hero.DeadStockValue = Round(dead.Sum(p => p.ClosingDeclared));
                hero.DeadStockItemCount = dead.Count;
                var everHeld = positions.Sum(p => p.EverHeldDeclared);
                hero.DeadStockPercent = everHeld > 0m
                    ? Math.Round(hero.DeadStockValue / everHeld * 100m, 1, MidpointRounding.AwayFromZero)
                    : null;

                // How much of what was imported has turned back into money.
                // Deliberately a SHARE, not months of cover: these companies
                // have 10-16 days of sales history, so an annualised rate
                // would be noise dressed up as insight.
                hero.StockConvertedValue = Round(positions.Sum(p => p.ConsumedDeclared));
                hero.StockConvertedPercent = everHeld > 0m
                    ? Math.Round(hero.StockConvertedValue / everHeld * 100m, 1, MidpointRounding.AwayFromZero)
                    : null;

                // Ageing of what is still held, by last movement.
                var ageAsOf = PakistanClock.Today;
                decimal Aged(Func<int, bool> test) => Round(positions
                    .Where(p => p.ClosingDeclared > 0m)
                    .Where(p => test((ageAsOf - (p.LastMovement?.Date ?? ageAsOf)).Days))
                    .Sum(p => p.ClosingDeclared));
                hero.StockAgeUnder30 = Aged(d => d < 30);
                hero.StockAge30To90 = Aged(d => d >= 30 && d < 90);
                hero.StockAgeOver90 = Aged(d => d >= 90);
            }

            // Margin on landed cost: what the goods actually cost, not what
            // customs declared them at (declared-basis profit reads ~0).
            hero.GrossMarginLanded = Round(hero.TotalSalesExcludingTax - hero.LandedCostOfSales);
            hero.GrossMarginLandedPct = hero.TotalSalesExcludingTax != 0m
                ? Math.Round(hero.GrossMarginLanded / hero.TotalSalesExcludingTax * 100m, 1, MidpointRounding.AwayFromZero)
                : null;

            // ── Receivables = the customer balance ─────────────────────────
            // The same aged-receivables result the accounting summary reports,
            // so the two screens cannot disagree (subledger: works with the GL
            // off). A position, so deliberately not date-filtered. Receipts
            // taken on account reduce it; 236G/H is billed on top, shown apart.
            // Aging has no division scope, so a division-restricted user gets
            // no figure rather than the company-wide balance.
            if (divScope != null)
            {
                hero.ReceivablesScopeRestricted = true;
            }
            else
            {
                var aged = await _gl.GetAgedReceivablesAsync(companyId);
                hero.ReceivablesTotal = aged.Total;
                hero.ReceivablesOverdue = aged.Total - aged.Current;
            }

            var advQ = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, period.From, period.To);
            if (divScope != null)
                advQ = advQ.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            hero.ReceivablesAdvanceTaxBilled = Round(await advQ.SumAsync(i => (decimal?)i.AdvanceTaxAmount) ?? 0m);

            var recQ = _context.Payments.AsNoTracking()
                .Where(p => p.CompanyId == companyId && p.Direction == PaymentDirection.Receipt && !p.IsCancelled);
            if (period.From.HasValue) recQ = recQ.Where(p => p.Date >= period.From.Value);
            if (period.To.HasValue) recQ = recQ.Where(p => p.Date < period.To.Value);
            if (divScope != null)
                recQ = recQ.Where(p => p.DivisionId == null || divScope.Contains(p.DivisionId.Value));
            hero.ReceivedInPeriod = Round(await recQ.SumAsync(p => (decimal?)p.Amount) ?? 0m);

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

        // ── KPI drill-downs ─────────────────────────────────────────────────

        /// <summary>
        /// The rows behind one KPI. Every breakdown is computed from the SAME
        /// source its card is — the item positions, or the same query — so the
        /// rows add up to the headline by construction rather than by luck. A
        /// drill-down that disagreed with the number it opened from would be
        /// worse than none at all.
        /// </summary>
        public async Task<(DashboardBreakdownDto? Dto, int Status, string? Error)> GetBreakdownAsync(
            int companyId, string kind, string periodCode, DateTime? from, DateTime? to,
            string? groupKey, ClaimsPrincipal user)
        {
            var userId = ResolveUserId(user);
            var divScope = userId.HasValue
                ? await _divisionAccess.GetAccessibleDivisionIdsAsync(userId.Value, companyId)
                : null;
            var period = BuildPeriod(periodCode, from, to);
            var k = (kind ?? "").Trim().ToLowerInvariant();
            var key = string.IsNullOrWhiteSpace(groupKey) ? null : groupKey.Trim();

            if (k is "sales" or "receivables" or "margin-landed" or "tax-payable" or "adv-tax-236")
                return await TwoLevelBreakdownAsync(companyId, k, periodCode, from, to, key, user, userId, divScope, period);

            // Every other kind has one level, so a group key is meaningless there.
            if (key != null) return (null, 400, InvalidGroup);
            if (k.StartsWith("health-", StringComparison.Ordinal))
                return await HealthBreakdownAsync(companyId, k, period, divScope, userId);
            return (await SingleLevelBreakdownAsync(companyId, k, kind ?? "", period, divScope), 200, null);
        }

        private async Task<DashboardBreakdownDto> SingleLevelBreakdownAsync(
            int companyId, string k, string kind, DashboardPeriod period, HashSet<int>? divScope)
        {
            var result = new DashboardBreakdownDto { Kind = k, AmountLabel = "Amount" };

            // Item-derived kinds share one walk.
            if (k is "cogs" or "cogs-landed" or "stock-on-hand" or "dead-stock"
                  or "real-margin" or "stock-converted" or "stock-ageing"
                  or "unrealised-margin" or "inventory-adjustments")
            {
                var positions = await LoadPositionsAsync(companyId, divScope, period.From, period.To);
                var ageAsOf = PakistanClock.Today;
                int DaysIdle(ItemStockPositions.Position p) =>
                    (ageAsOf - (p.LastMovement?.Date ?? ageAsOf)).Days;

                // Margin is REVENUE less landed cost, so the rows need what each
                // item actually sold for. Without this the breakdown summed
                // declared value less landed cost instead, which is a different
                // number and did not add up to its own card.
                Dictionary<int, decimal> revenueByItem = new();
                decimal unclassifiedRevenue = 0m;
                if (k == "real-margin")
                {
                    var lineQuery = _context.InvoiceItems.AsNoTracking()
                        .Where(ii => ii.Invoice!.CompanyId == companyId
                                  && !ii.Invoice.IsDemo && !ii.Invoice.IsCancelled
                                  && ii.Invoice.FbrCancelledAt == null);
                    if (divScope != null)
                        lineQuery = lineQuery.Where(ii => ii.Invoice!.DivisionId == null
                            || divScope.Contains(ii.Invoice.DivisionId!.Value));
                    if (period.From.HasValue)
                        lineQuery = lineQuery.Where(ii => ii.Invoice!.Date >= period.From.Value);
                    if (period.To.HasValue)
                        lineQuery = lineQuery.Where(ii => ii.Invoice!.Date < period.To.Value);

                    var lines = await lineQuery
                        .Select(ii => new { ii.ItemTypeId, LineTotal = (ii.Invoice!.DocumentType == 10 ? -1m : 1m) * ii.LineTotal })
                        .ToListAsync();
                    revenueByItem = lines.Where(l => l.ItemTypeId != null)
                        .GroupBy(l => l.ItemTypeId!.Value)
                        .ToDictionary(g => g.Key, g => Round(g.Sum(x => x.LineTotal)));
                    // Lines with no item type earn revenue but relieve no stock;
                    // they get their own row so the total still reconciles
                    // rather than quietly going missing.
                    unclassifiedRevenue = Round(lines.Where(l => l.ItemTypeId == null)
                        .Sum(l => l.LineTotal));
                }

                string title, note, secondaryLabel;
                Func<ItemStockPositions.Position, decimal> amount;
                Func<ItemStockPositions.Position, bool> include, flag;
                Func<ItemStockPositions.Position, string?> sub;
                Func<ItemStockPositions.Position, decimal?> secondary;

                switch (k)
                {
                    case "cogs":
                        title = "Cost of goods sold, by item";
                        note = "Declared value of what left stock in this period, at weighted average.";
                        amount = p => p.ConsumedDeclared;
                        include = p => p.ConsumedDeclared != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.SoldQuantity;
                        secondaryLabel = "Qty sold";
                        flag = _ => false;
                        break;
                    case "cogs-landed":
                        title = "Cost of goods sold at landed cost, by item";
                        note = "What the goods that left actually cost, rather than their declared value.";
                        amount = p => p.ConsumedLanded;
                        include = p => p.ConsumedLanded != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ConsumedDeclared;
                        secondaryLabel = "Declared";
                        flag = _ => false;
                        break;
                    case "stock-on-hand":
                        title = "Stock on hand, by item";
                        note = "Declared value still in the warehouse. Not period-scoped — stock is a position, not a flow.";
                        amount = p => p.ClosingDeclared;
                        include = p => p.ClosingDeclared != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ClosingQuantity;
                        secondaryLabel = "Qty";
                        flag = p => p.NeverSold;
                        break;
                    case "dead-stock":
                        title = "Stock that has never sold";
                        note = "Items still holding value that have not gone out once.";
                        amount = p => p.ClosingDeclared;
                        include = p => p.NeverSold && p.ClosingDeclared > 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ClosingQuantity;
                        secondaryLabel = "Qty";
                        flag = _ => true;
                        break;
                    case "real-margin":
                        title = "Margin on landed cost, by item";
                        note = "What each item SOLD for, less what those goods actually cost. Flagged rows sold for less than they cost.";
                        amount = p => revenueByItem.GetValueOrDefault(p.ItemTypeId) - p.ConsumedLanded;
                        include = p => revenueByItem.ContainsKey(p.ItemTypeId) || p.ConsumedLanded != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ConsumedLanded;
                        secondaryLabel = "Landed cost";
                        flag = p => revenueByItem.GetValueOrDefault(p.ItemTypeId) < p.ConsumedLanded;
                        break;
                    case "stock-converted":
                        title = "Stock converted to sales, by item";
                        note = "Declared value that has turned back into money.";
                        amount = p => p.ConsumedDeclared;
                        include = p => p.ConsumedDeclared != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ClosingDeclared;
                        secondaryLabel = "Still held";
                        flag = _ => false;
                        break;
                    case "stock-ageing":
                        title = "Stock still held, by age";
                        note = "Days since the item last moved. Opening balances share one as-of date, so early on these bunch into one bucket.";
                        amount = p => p.ClosingDeclared;
                        include = p => p.ClosingDeclared > 0m;
                        sub = p => DaysIdle(p) + " days since last movement";
                        secondary = p => p.ClosingQuantity;
                        secondaryLabel = "Qty";
                        flag = p => DaysIdle(p) >= 90;
                        break;
                    case "unrealised-margin":
                        title = "Margin locked up in unsold stock";
                        note = "Declared value less landed cost on goods still held — profit not yet earned.";
                        amount = p => p.UnrealisedMargin;
                        include = p => p.ClosingDeclared != 0m;
                        sub = p => p.HsCode;
                        secondary = p => p.ClosingLanded;
                        secondaryLabel = "Landed cost";
                        flag = p => p.UnrealisedMargin < 0m;
                        break;
                    default:
                        title = "Inventory adjustments, by item";
                        note = "Breakage, count corrections and revaluations — deliberately kept out of cost of sales.";
                        amount = p => p.AdjustmentsDeclared;
                        include = p => p.AdjustmentsDeclared != 0m;
                        sub = p => p.HsCode;
                        secondary = _ => null;
                        secondaryLabel = "";
                        flag = _ => true;
                        break;
                }

                result.Title = title;
                result.Note = note;
                result.AmountLabel = "Value";
                result.Rows = positions.Where(include)
                    .Select(p => new DashboardBreakdownRowDto
                    {
                        Id = p.ItemTypeId,
                        Label = p.Name,
                        Sub = sub(p),
                        Amount = amount(p),
                        Secondary = secondary(p),
                        SecondaryLabel = string.IsNullOrEmpty(secondaryLabel) ? null : secondaryLabel,
                        Flagged = flag(p),
                    })
                    .OrderByDescending(r => Math.Abs(r.Amount))
                    .ToList();

                if (k == "real-margin" && unclassifiedRevenue != 0m)
                    result.Rows.Add(new DashboardBreakdownRowDto
                    {
                        Label = "(lines with no item type)",
                        Sub = "Earned revenue but relieved no stock",
                        Amount = unclassifiedRevenue,
                    });

                result.Total = Round(result.Rows.Sum(r => r.Amount));
                return result;
            }

            switch (k)
            {
                case "payables":
                case "recoverable-tax":
                {
                    var owed = k == "payables";
                    var wanted = (owed
                        ? new[] { ControlType.AccountsPayable, ControlType.OutputTax,
                                  ControlType.FurtherTaxPayable, ControlType.WithholdingPayable,
                                  ControlType.ImportClearing }
                        : new[] { ControlType.InputTax, ControlType.AdvanceIncomeTaxOnImports })
                        .ToHashSet();

                    var accounts = await _context.Accounts.AsNoTracking()
                        .Where(a => a.CompanyId == companyId && a.IsActive)
                        .Select(a => new
                        {
                            a.Id,
                            a.Name,
                            a.ControlType,
                            Opening = a.OpeningBalanceIsDebit ? a.OpeningBalance : -a.OpeningBalance,
                            Movement = _context.JournalLines
                                .Where(jl => jl.AccountId == a.Id && jl.JournalEntry.CompanyId == companyId)
                                .Sum(jl => (decimal?)(jl.Debit - jl.Credit)) ?? 0m,
                        })
                        .ToListAsync();

                    result.Title = owed ? "Everything owed, by account" : "Recoverable from FBR, by account";
                    result.Note = owed
                        ? "Trade creditors, tax payable and unsettled import clearing. An importer usually has no suppliers on the books."
                        : "Input sales tax and advance income tax paid at import — assets you credit back, not money owed.";
                    result.Rows = accounts
                        .Where(a => wanted.Contains(a.ControlType))
                        // Liabilities are credit-natural; flip so "owed" reads positive.
                        .Select(a => new DashboardBreakdownRowDto
                        {
                            Id = a.Id,
                            Label = a.Name,
                            Sub = a.ControlType.ToString(),
                            Amount = Round(owed ? -(a.Opening + a.Movement) : a.Opening + a.Movement),
                        })
                        .Where(r => r.Amount != 0m)
                        .OrderByDescending(r => Math.Abs(r.Amount))
                        .ToList();
                    result.Total = Round(result.Rows.Sum(r => r.Amount));
                    return result;
                }

                case "import-book":
                case "duty-burden":
                {
                    var duty = k == "duty-burden";
                    var gds = await _context.ImportConsignments.AsNoTracking()
                        .Where(c => c.CompanyId == companyId)
                        .Select(c => new
                        {
                            c.Id, c.GdNumber, c.GdDate, c.Mode,
                            c.TotalCostExcludingTax, c.TotalInputTax, c.TotalIncomeTax,
                            c.AmountSettled, c.ImportClearingCredited,
                        })
                        .ToListAsync();

                    result.Title = duty ? "Duty and tax per consignment" : "Import book, by GD";
                    result.Note = duty
                        ? "Input sales tax plus advance income tax paid at clearance, against what the goods cost."
                        : "Every GD costed into this company. A Backfill consignment posts nothing to the ledger by design, so its clearing reads zero.";
                    result.Rows = gds
                        .Select(c => new DashboardBreakdownRowDto
                        {
                            Id = c.Id,
                            Label = string.IsNullOrWhiteSpace(c.GdNumber) ? "(no GD number)" : c.GdNumber,
                            Sub = c.GdDate.ToString("dd MMM yyyy") + " · " + c.Mode,
                            Amount = duty
                                ? Round(c.TotalInputTax + c.TotalIncomeTax)
                                : Round(c.TotalCostExcludingTax),
                            Secondary = duty
                                ? Round(c.TotalCostExcludingTax)
                                : Round(c.ImportClearingCredited - c.AmountSettled),
                            SecondaryLabel = duty ? "Landed cost" : "Outstanding",
                            Flagged = !duty && c.ImportClearingCredited == 0m,
                        })
                        .OrderByDescending(r => r.Amount)
                        .ToList();
                    result.Total = Round(result.Rows.Sum(r => r.Amount));
                    return result;
                }

                default:
                    result.Title = "Unknown breakdown";
                    result.Note = "No drill-down is defined for '" + kind + "'.";
                    return result;
            }
        }

        // ── Two-level drill-downs (2026-10-18) ──────────────────────────────
        //
        // Level 1 (no groupKey) lists groups that sum to the card; level 2 lists
        // what is behind one group, newest first, capped at 500. Every query is
        // filtered by the route's company, so a well-formed key naming another
        // company's client or item answers with no rows. Each kind reads the SAME
        // source as its card: the sale filter, the aged receivables report, the
        // stock walk, the tax position.

        private const string InvalidGroup = "Invalid group.";
        private const int Level2Cap = 500;
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static readonly string[] TaxLines = { "output", "further", "input", "236G", "236H", "wht" };

        private static readonly (string Key, string Label, string Kind)[] InvoiceCols =
        {
            ("date", "Date", "date"), ("customer", "Customer", "text"), ("net", "Net", "money"),
            ("gst", "Sales tax", "money"), ("furtherTax", "Further tax", "money"),
            ("advSection", "236 section", "text"), ("adv236", "236G/H", "money"),
            ("wht", "WHT", "money"), ("grandTotal", "Grand total", "money"), ("fbrStatus", "FBR", "status"),
        };

        private static List<DashboardColumn> Cols(params (string Key, string Label, string Kind)[] c) =>
            c.Select(x => new DashboardColumn { Key = x.Key, Label = x.Label, Kind = x.Kind }).ToList();

        private static DashboardBreakdownRowDto GroupRow(string? key, string label, decimal amount,
            params (string Key, object? Value)[] values)
        {
            var row = new DashboardBreakdownRowDto { GroupKey = key, Label = label, Amount = Round(amount) };
            foreach (var (k, v) in values) row.Values[k] = v;
            return row;
        }

        private sealed record InvRow(int Id, int Number, DateTime Date, string? Customer, int? DocType, decimal Sign,
            decimal Subtotal, decimal Gst, decimal Further, string? AdvSection, decimal Adv, decimal Wht,
            decimal GrandTotal, decimal AmountPaid, string? FbrStatus);

        private static IQueryable<InvRow> InvRows(IQueryable<Invoice> q) => q.Select(i => new InvRow(
            i.Id, i.InvoiceNumber, i.Date, i.Client!.Name, i.DocumentType, i.DocumentType == 10 ? -1m : 1m,
            i.Subtotal, i.GSTAmount, i.FurtherTaxAmount, i.AdvanceTaxSection, i.AdvanceTaxAmount,
            i.WithholdingTaxAmount, i.GrandTotal, i.AmountPaid, i.FbrStatus));

        /// <summary>An invoice row: money signed like Amount (a credit note reads negative).</summary>
        private static DashboardBreakdownRowDto InvoiceRow(InvRow r, decimal amount) => new()
        {
            Id = r.Id,
            InvoiceId = r.Id,
            InvoiceNumber = r.Number,
            Label = r.Customer ?? "(unknown)",
            Sub = "#" + r.Number + " · " + r.Date.ToString("dd MMM yyyy", Inv)
                + (r.DocType == 10 ? " · credit note" : r.DocType == 9 ? " · debit note" : ""),
            Amount = Round(amount),
            Values = new()
            {
                ["date"] = r.Date, ["customer"] = r.Customer, ["net"] = Round(r.Sign * r.Subtotal),
                ["gst"] = Round(r.Sign * r.Gst), ["furtherTax"] = Round(r.Sign * r.Further),
                ["advSection"] = r.AdvSection, ["adv236"] = Round(r.Sign * r.Adv),
                ["wht"] = Round(r.Sign * r.Wht), ["grandTotal"] = Round(r.Sign * r.GrandTotal),
                ["fbrStatus"] = r.FbrStatus,
            },
        };

        private static IEnumerable<InvRow> Newest(IEnumerable<InvRow> rows) =>
            rows.OrderByDescending(r => r.Date).ThenByDescending(r => r.Id);

        /// <summary>Caps an already-ordered level 2. Total stays the whole group's figure.</summary>
        private static DashboardBreakdownDto FillLevel2(DashboardBreakdownDto result,
            IEnumerable<DashboardBreakdownRowDto> ordered, decimal total)
        {
            var all = ordered.ToList();
            result.Truncated = all.Count > Level2Cap;
            result.Rows = all.Take(Level2Cap).ToList();
            result.Total = Round(total);
            return result;
        }

        private static bool TryMonthKey(string s, out DateTime month) =>
            DateTime.TryParseExact(s, "yyyy-MM", Inv, DateTimeStyles.None, out month)
            && month.Year is >= 2000 and <= 2100;

        private static bool TryIdKey(string s, char prefix, out int id)
        {
            id = 0;
            return s.Length > 2 && s[0] == prefix && s[1] == ':'
                && int.TryParse(s.AsSpan(2), NumberStyles.AllowLeadingSign, Inv, out id);
        }

        private static bool TryAdvKey(string s, out DateTime month, out string section)
        {
            month = default;
            section = "";
            var parts = s.Split(':');
            if (parts.Length != 2 || parts[1] is not ("236G" or "236H") || !TryMonthKey(parts[0], out month)) return false;
            section = parts[1];
            return true;
        }

        private async Task<(DashboardBreakdownDto? Dto, int Status, string? Error)> TwoLevelBreakdownAsync(
            int companyId, string k, string periodCode, DateTime? from, DateTime? to, string? key,
            ClaimsPrincipal user, int? userId, HashSet<int>? divScope, DashboardPeriod period)
        {
            var result = new DashboardBreakdownDto
            {
                Kind = k, Level = key == null ? 1 : 2, GroupKey = key, AmountLabel = "Amount",
            };

            if (k is "tax-payable" or "adv-tax-236")
            {
                if (key != null && !(k == "tax-payable" ? TaxLines.Contains(key) : TryAdvKey(key, out _, out _)))
                    return (null, 400, InvalidGroup);
                // The panel's own gate (sales KPI permission, company-wide only)
                // and its own window and figures.
                var (ctx, refusal) = await LoadTaxPositionAsync(companyId, periodCode, from, to, user);
                if (ctx == null) return (null, 403, refusal);
                return (k == "tax-payable"
                    ? await TaxPayableBreakdownAsync(companyId, ctx, key, result)
                    : await AdvTaxBreakdownAsync(companyId, ctx, key, result), 200, null);
            }

            // Sales figures: the same permission the Overview's sales cards need.
            var perms = userId.HasValue
                ? await _permissions.GetUserPermissionsAsync(userId.Value)
                : (IReadOnlyCollection<string>)Array.Empty<string>();
            if (!perms.Contains("dashboard.kpi.sales.view"))
                return (null, 403, "You do not have access to these figures.");

            DashboardBreakdownDto? dto;
            switch (k)
            {
                case "sales":
                    dto = await SalesBreakdownAsync(companyId, period, divScope, key, result);
                    break;
                case "receivables":
                    // The aged report has no division scope; the card is withheld
                    // from a division-restricted user, so is its drill.
                    if (divScope != null) return (null, 403, "Receivables are company-wide only.");
                    dto = await ReceivablesBreakdownAsync(companyId, key, result);
                    break;
                default:
                    dto = await MarginBreakdownAsync(companyId, period, divScope, key, result);
                    break;
            }
            return dto == null ? (null, 400, InvalidGroup) : (dto, 200, null);
        }

        // sales: level 1 by month (a year or more) or by customer group; level 2 invoices.
        private async Task<DashboardBreakdownDto?> SalesBreakdownAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope, string? key, DashboardBreakdownDto result)
        {
            var q = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, period.From, period.To);
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            result.AmountLabel = "Net sales";

            if (key == null)
            {
                var byMonth = period.From == null || period.To == null
                    || period.Code is "this-year" or "last-year"
                    || (period.To.Value - period.From.Value).TotalDays >= 365;
                result.Columns = Cols(("invoices", "Documents", "number"), ("net", "Net", "money"),
                    ("gst", "Sales tax", "money"), ("grandTotal", "Grand total", "money"));
                result.Note = "Excluding tax; credit notes subtract and debit notes add. Open a row for its documents.";
                if (byMonth)
                {
                    result.Title = "Net sales, by month";
                    var months = await q.GroupBy(i => new { i.Date.Year, i.Date.Month })
                        .Select(g => new
                        {
                            g.Key.Year, g.Key.Month, Count = g.Count(),
                            Net = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.Subtotal),
                            Gst = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GSTAmount),
                            Grand = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
                        })
                        .ToListAsync();
                    result.Rows = months.OrderByDescending(x => x.Year).ThenByDescending(x => x.Month).Select(x =>
                    {
                        var m = new DateTime(x.Year, x.Month, 1);
                        return GroupRow(m.ToString("yyyy-MM", Inv), m.ToString("MMM yyyy", Inv), x.Net,
                            ("invoices", x.Count), ("net", Round(x.Net)), ("gst", Round(x.Gst)), ("grandTotal", Round(x.Grand)));
                    }).ToList();
                }
                else
                {
                    // CLAUDE.md §5: one legal entity kept under several client records reads as one customer.
                    result.Title = "Net sales, by customer";
                    var groups = await q.GroupBy(i => i.Client!.ClientGroupId ?? -i.ClientId)
                        .Select(g => new
                        {
                            g.Key, Count = g.Count(),
                            Name = g.Max(i => i.Client!.ClientGroup != null ? i.Client.ClientGroup.DisplayName : i.Client.Name),
                            Net = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.Subtotal),
                            Gst = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GSTAmount),
                            Grand = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
                        })
                        .ToListAsync();
                    result.Rows = groups.OrderByDescending(x => x.Net).Select(x =>
                        GroupRow("c:" + x.Key.ToString(Inv), x.Name ?? "(unknown)", x.Net,
                            ("invoices", x.Count), ("net", Round(x.Net)), ("gst", Round(x.Gst)), ("grandTotal", Round(x.Grand))))
                        .ToList();
                }
                result.Total = Round(result.Rows.Sum(r => r.Amount));
                return result;
            }

            IQueryable<Invoice> g;
            if (TryMonthKey(key, out var month))
            {
                var next = month.AddMonths(1);
                g = q.Where(i => i.Date >= month && i.Date < next);
                result.Title = "Sales in " + month.ToString("MMMM yyyy", Inv);
            }
            else if (TryIdKey(key, 'c', out var gid) && gid != 0)
            {
                var clientId = -gid;
                g = gid > 0
                    ? q.Where(i => i.Client!.ClientGroupId == gid)
                    : q.Where(i => i.ClientId == clientId && i.Client!.ClientGroupId == null);
                result.Title = "Sales to one customer";
            }
            else return null;

            result.Note = "Net is the figure the card adds up; credit notes read negative.";
            result.Columns = Cols(InvoiceCols);
            var list = await InvRows(g).ToListAsync();
            return FillLevel2(result, Newest(list).Select(r => InvoiceRow(r, r.Sign * r.Subtotal)),
                list.Sum(r => r.Sign * r.Subtotal));
        }

        // receivables: level 1 = the aged report's customers; level 2 = their open bills + on-account.
        private async Task<DashboardBreakdownDto?> ReceivablesBreakdownAsync(
            int companyId, string? key, DashboardBreakdownDto result)
        {
            var clientId = 0;
            if (key != null && !(TryIdKey(key, 'c', out clientId) && clientId > 0)) return null;

            var aged = await _gl.GetAgedReceivablesAsync(companyId);
            // GeneralLedgerService.BuildAgingAsync's own open-document test (as of now).
            var open = _context.Invoices.AsNoTracking()
                .Where(i => i.CompanyId == companyId && !i.IsDemo && !i.IsCancelled
                         && i.DocumentType != 9 && i.DocumentType != 10
                         && i.GrandTotal - i.WithholdingTaxAmount - i.AmountPaid > 0m);
            result.AmountLabel = "Balance";

            if (key == null)
            {
                var docs = await open.GroupBy(i => i.ClientId)
                    .Select(g => new
                    {
                        ClientId = g.Key,
                        Invoiced = g.Sum(i => i.GrandTotal),
                        Wht = g.Sum(i => i.WithholdingTaxAmount),
                        Receipts = g.Sum(i => i.AmountPaid),
                        Adv = g.Sum(i => i.AdvanceTaxAmount),
                    })
                    .ToDictionaryAsync(x => x.ClientId);
                result.Title = "Receivables, by customer";
                result.Note = "The customer balance from the aged receivables report: open bills, less WHT and what was "
                    + "received against them, plus money held on account (negative). 236G/H billed on those bills is shown apart. "
                    + "Flagged customers have money past due.";
                result.Columns = Cols(("invoiced", "Invoiced", "money"), ("wht", "WHT", "money"),
                    ("receipts", "Receipts", "money"), ("onAccount", "On account", "money"),
                    ("balance", "Balance", "money"), ("adv236Billed", "236G/H billed", "money"));
                result.Rows = aged.Rows.Select(a =>
                {
                    docs.TryGetValue(a.PartyId, out var d);
                    var invoiced = d?.Invoiced ?? 0m;
                    var wht = d?.Wht ?? 0m;
                    var receipts = d?.Receipts ?? 0m;
                    var row = GroupRow("c:" + a.PartyId.ToString(Inv), a.Name, a.Total,
                        ("invoiced", Round(invoiced)), ("wht", Round(wht)), ("receipts", Round(receipts)),
                        ("onAccount", Round(a.Total - (invoiced - wht - receipts))), ("balance", Round(a.Total)),
                        ("adv236Billed", Round(d?.Adv ?? 0m)));
                    row.Sub = a.OpenDocuments + " open bill" + (a.OpenDocuments == 1 ? "" : "s");
                    row.Flagged = a.Total - a.Current > 0m;
                    return row;
                }).ToList();
                result.Total = Round(aged.Total);
                return result;
            }

            var party = aged.Rows.FirstOrDefault(r => r.PartyId == clientId);
            var list = await InvRows(open.Where(i => i.ClientId == clientId)).ToListAsync();
            result.Title = "Open bills for " + (party?.Name ?? "this customer");
            result.Note = "What is still due on each bill (grand total less WHT and receipts applied), plus money held on account.";
            result.Columns = Cols(InvoiceCols);
            var rows = new List<DashboardBreakdownRowDto>();
            var onAccount = (party?.Total ?? 0m) - list.Sum(r => r.GrandTotal - r.Wht - r.AmountPaid);
            if (Math.Abs(onAccount) >= 0.005m)
                rows.Add(new DashboardBreakdownRowDto
                {
                    Label = "On account",
                    Sub = "Received and not applied to a bill (negative: held for the customer)",
                    Amount = Round(onAccount),
                });
            rows.AddRange(Newest(list).Select(r => InvoiceRow(r, r.GrandTotal - r.Wht - r.AmountPaid)));
            return FillLevel2(result, rows, party?.Total ?? 0m);
        }

        // margin-landed: level 1 = item types from the stock walk; level 2 = the invoices carrying that item.
        private async Task<DashboardBreakdownDto?> MarginBreakdownAsync(
            int companyId, DashboardPeriod period, HashSet<int>? divScope, string? key, DashboardBreakdownDto result)
        {
            var itemId = 0;
            if (key != null && !(TryIdKey(key, 'i', out itemId) && itemId >= 0)) return null;

            var sales = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, period.From, period.To);
            if (divScope != null)
                sales = sales.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            var saleIds = sales.Select(i => i.Id);
            var lineQ = _context.InvoiceItems.AsNoTracking().Where(ii => saleIds.Contains(ii.InvoiceId));
            if (key != null)
                lineQ = itemId == 0 ? lineQ.Where(ii => ii.ItemTypeId == null) : lineQ.Where(ii => ii.ItemTypeId == itemId);
            var lines = await lineQ
                .Select(ii => new { ii.ItemTypeId, ii.InvoiceId, Net = (ii.Invoice!.DocumentType == 10 ? -1m : 1m) * ii.LineTotal })
                .ToListAsync();
            var inputs = await LoadPositionInputsAsync(companyId, divScope);
            result.AmountLabel = "Margin";

            if (key == null)
            {
                var positions = ItemStockPositions.Compute(inputs.Openings, inputs.MovementsByItem, inputs.Names,
                    period.From, period.To, inputs.Costing);
                var (_, _, netSales) = await SumInvoicesAsync(companyId, period.From, period.To, divScope);
                var revenue = lines.Where(l => l.ItemTypeId != null)
                    .GroupBy(l => l.ItemTypeId!.Value).ToDictionary(g => g.Key, g => g.Sum(x => x.Net));
                var byItem = positions.ToDictionary(p => p.ItemTypeId);
                var ids = revenue.Keys.Union(positions.Where(p => p.ConsumedLanded != 0m).Select(p => p.ItemTypeId)).ToList();
                var missing = ids.Where(id => !inputs.Names.ContainsKey(id)).ToList();
                var otherNames = missing.Count == 0
                    ? new Dictionary<int, string>()
                    : await _context.ItemTypes.AsNoTracking().Where(it => missing.Contains(it.Id))
                        .ToDictionaryAsync(it => it.Id, it => it.Name);

                result.Title = "Margin on landed cost, by item";
                result.Note = "Net sales of each item less what those goods actually cost (the stock walk behind Landed cost of sales). Flagged items sold below cost.";
                result.Columns = Cols(("revenue", "Net sales", "money"), ("landed", "Landed cost", "money"), ("margin", "Margin", "money"));
                result.Rows = ids.Select(id =>
                {
                    var rev = revenue.GetValueOrDefault(id);
                    byItem.TryGetValue(id, out var p);
                    var cost = p?.ConsumedLanded ?? 0m;
                    var name = inputs.Names.TryGetValue(id, out var n) ? n.Name
                        : otherNames.GetValueOrDefault(id) ?? "(item " + id.ToString(Inv) + ")";
                    var row = GroupRow("i:" + id.ToString(Inv), name, rev - cost,
                        ("revenue", Round(rev)), ("landed", Round(cost)), ("margin", Round(rev - cost)));
                    row.Sub = p?.HsCode;
                    row.Flagged = rev < cost;
                    return row;
                }).OrderByDescending(r => Math.Abs(r.Amount)).ToList();

                var unclassified = lines.Where(l => l.ItemTypeId == null).Sum(l => l.Net);
                if (unclassified != 0m)
                {
                    var row = GroupRow("i:0", "(lines with no item type)", unclassified,
                        ("revenue", Round(unclassified)), ("landed", 0m), ("margin", Round(unclassified)));
                    row.Sub = "Earned revenue but relieved no stock";
                    result.Rows.Add(row);
                }
                // Bills with no line detail (migrated history) still count in net sales.
                var noLines = await sales.Where(i => !i.Items.Any())
                    .SumAsync(i => (decimal?)((i.DocumentType == 10 ? -1m : 1m) * i.Subtotal)) ?? 0m;
                if (Math.Abs(noLines) >= 0.005m)
                {
                    var row = GroupRow(null, "Sales with no line detail", noLines,
                        ("revenue", Round(noLines)), ("landed", 0m), ("margin", Round(noLines)));
                    row.Sub = "Bills recorded without item lines: revenue with nothing to cost";
                    result.Rows.Add(row);
                }
                var differs = netSales - lines.Sum(l => l.Net) - noLines;
                if (Math.Abs(differs) >= 0.005m)
                {
                    var row = GroupRow(null, "Rounding / line totals differ from bill subtotal", differs,
                        ("revenue", Round(differs)), ("landed", 0m), ("margin", Round(differs)));
                    row.Sub = "Bills whose item lines do not add up to their subtotal";
                    result.Rows.Add(row);
                }
                // The card's own formula: net sales less the walk's landed cost.
                result.Total = Round(netSales - Round(positions.Sum(p => p.ConsumedLanded)));
                return result;
            }

            // Level 2: the invoices carrying the item, each with its own landed
            // share from the walk (per sale movement), not an average.
            var revByInv = lines.Where(l => itemId == 0 ? l.ItemTypeId == null : l.ItemTypeId == itemId)
                .GroupBy(l => l.InvoiceId).ToDictionary(g => g.Key, g => g.Sum(x => x.Net));
            var landedByInv = new Dictionary<int, decimal>();
            var itemLanded = 0m;
            if (itemId != 0 && inputs.Names.TryGetValue(itemId, out var meta))
            {
                var one = new Dictionary<int, (string Name, string? HsCode)> { [itemId] = meta };
                itemLanded = ItemStockPositions.Compute(inputs.Openings, inputs.MovementsByItem, one,
                    period.From, period.To, inputs.Costing, landedByInv).Sum(p => p.ConsumedLanded);
            }
            var total = revByInv.Values.Sum() - itemLanded;

            var invIds = revByInv.Keys.Union(landedByInv.Keys).ToList();
            var list = invIds.Count == 0 ? new List<InvRow>()
                : await InvRows(sales.Where(i => invIds.Contains(i.Id))).ToListAsync();
            result.Title = itemId == 0 ? "Bills with lines that carry no item type"
                : "Bills carrying " + (inputs.Names.TryGetValue(itemId, out var nm) ? nm.Name : "this item");
            result.Note = "Each bill's margin is that item's net on the bill less the landed cost the stock walk took for that sale.";
            result.Columns = Cols(InvoiceCols.Concat(new[] { ("itemNet", "Item net", "money"), ("itemLanded", "Item landed cost", "money") }).ToArray());
            var rows = Newest(list).Select(r =>
            {
                var net = Round(revByInv.GetValueOrDefault(r.Id));
                var cost = Round(landedByInv.GetValueOrDefault(r.Id));
                var row = InvoiceRow(r, net - cost);
                row.Values["itemNet"] = net;
                row.Values["itemLanded"] = cost;
                row.Flagged = net < cost;
                return row;
            }).ToList();
            // Cost with no listed bill: a FIFO settlement booked on a later
            // purchase (CLAUDE.md §5b-17), or a sale outside the filter.
            var rest = Round(total) - rows.Sum(r => r.Amount);
            if (Math.Abs(rest) >= 0.005m)
                rows.Insert(0, new DashboardBreakdownRowDto
                {
                    Label = "Cost not tied to a listed bill",
                    Sub = "FIFO settlement by a later purchase, or rounding",
                    Amount = rest,
                });
            return FillLevel2(result, rows, total);
        }

        // tax-payable: level 1 = the panel's lines; level 2 = invoices, GD lines or journal entries.
        private async Task<DashboardBreakdownDto> TaxPayableBreakdownAsync(
            int companyId, TaxContext ctx, string? key, DashboardBreakdownDto result)
        {
            var d = ctx.Dto;
            var months = d.FromMonth == d.ToMonth ? d.FromMonth : d.FromMonth + " to " + d.ToMonth;
            var worksheet = d.InputBasis == "worksheet";
            if (key == null)
            {
                result.Title = "Payable to FBR, by line";
                result.Note = "Whole months " + months + ", as the return is filed. Input tax reduces what is payable, so it reads negative. "
                    + (worksheet ? "Input comes from the Import Tax Desk worksheet." : "Input comes from the ledger, before the 8B cap.");
                result.Rows = new List<DashboardBreakdownRowDto>
                {
                    GroupRow("output", "Output sales tax", d.OutputTax),
                    GroupRow("further", "Further tax", d.FurtherTax),
                    GroupRow("input", "Input sales tax claimed", -d.InputTaxClaimed),
                };
                // Whatever turns output - input into the payable the panel shows.
                var adjust = d.SalesTaxPayable - (d.OutputTax + d.FurtherTax - d.InputTaxClaimed);
                if (adjust != 0m)
                {
                    var row = GroupRow(null, worksheet ? "Carry-forward and 8B cap" : "Input above output (nothing payable)", adjust);
                    row.Sub = worksheet ? "As the Import Tax Desk worksheet applies them" : "Sales tax payable cannot go below zero";
                    result.Rows.Add(row);
                }
                result.Rows.Add(GroupRow("236G", "236G collected", d.Adv236G));
                result.Rows.Add(GroupRow("236H", "236H collected", d.Adv236H));
                result.Rows.Add(GroupRow("wht", "WHT payable (s.153, deducted by us)", d.WhtPayable));
                result.Total = d.TotalPayable;
                return result;
            }

            var docs = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, ctx.First, ctx.End);
            result.Note = "Whole months " + months + ".";
            switch (key)
            {
                case "output":
                case "further":
                case "236G":
                case "236H":
                {
                    IQueryable<Invoice> q = key switch
                    {
                        "output" => docs.Where(i => i.GSTAmount != 0m),
                        "further" => docs.Where(i => i.FurtherTaxAmount != 0m),
                        _ => docs.Where(i => i.AdvanceTaxSection == key && i.AdvanceTaxAmount != 0m),
                    };
                    Func<InvRow, decimal> amount = key switch
                    {
                        "output" => r => r.Sign * r.Gst,
                        "further" => r => r.Sign * r.Further,
                        _ => r => r.Sign * r.Adv,
                    };
                    result.Title = key switch
                    {
                        "output" => "Output sales tax, by bill",
                        "further" => "Further tax, by bill",
                        _ => key + " collected, by bill",
                    };
                    result.AmountLabel = "Tax";
                    result.Columns = Cols(InvoiceCols);
                    var list = await InvRows(q).ToListAsync();
                    var total = key switch
                    {
                        "output" => d.OutputTax, "further" => d.FurtherTax, "236G" => d.Adv236G, _ => d.Adv236H,
                    };
                    return FillLevel2(result, Newest(list).Select(r => InvoiceRow(r, amount(r))), total);
                }
                case "wht":
                    result.Title = "WHT payable, by journal entry";
                    result.AmountLabel = "WHT";
                    return await JournalLevelAsync(companyId, ctx, ControlType.WithholdingPayable, result, d.WhtPayable);
                default: // input
                    result.AmountLabel = "Input tax";
                    if (!worksheet)
                    {
                        result.Title = "Input tax, by journal entry";
                        return await JournalLevelAsync(companyId, ctx, ControlType.InputTax, result, -d.InputTaxClaimed);
                    }
                    return await WorksheetInputAsync(companyId, ctx, result);
            }
        }

        /// <summary>Journal entries behind a GL tax line, signed as the panel reads them
        /// (credit-natural WHT payable positive, input tax negative).</summary>
        private async Task<DashboardBreakdownDto> JournalLevelAsync(
            int companyId, TaxContext ctx, ControlType role, DashboardBreakdownDto result, decimal total)
        {
            result.Columns = Cols(("date", "Date", "date"), ("entryNo", "Entry", "number"),
                ("narration", "Narration", "text"), ("amount", "Amount", "money"));
            if (!ctx.Dto.LedgerEnabled) return FillLevel2(result, Array.Empty<DashboardBreakdownRowDto>(), total);
            var entries = await TaxGlLines(companyId, ctx.First, ctx.End, new[] { role })
                .GroupBy(jl => new { jl.JournalEntryId, jl.JournalEntry.EntryNo, jl.JournalEntry.Date, jl.JournalEntry.Narration })
                .Select(g => new { g.Key.JournalEntryId, g.Key.EntryNo, g.Key.Date, g.Key.Narration, Net = g.Sum(jl => jl.Debit - jl.Credit) })
                .ToListAsync();
            var rows = entries.Where(x => x.Net != 0m)
                .OrderByDescending(x => x.Date).ThenByDescending(x => x.JournalEntryId)
                .Select(x => GroupRow(null, string.IsNullOrWhiteSpace(x.Narration) ? "Journal entry " + x.EntryNo : x.Narration!, -x.Net,
                    ("date", x.Date), ("entryNo", x.EntryNo), ("narration", x.Narration), ("amount", Round(-x.Net))));
            return FillLevel2(result, rows, total);
        }

        /// <summary>The Import Tax Desk worksheet's input for the panel's months: GD
        /// lines claimed in them (sales tax + value-added tax + other, as the
        /// worksheet adds them) and purchase bills less purchase debit notes.</summary>
        private async Task<DashboardBreakdownDto> WorksheetInputAsync(int companyId, TaxContext ctx, DashboardBreakdownDto result)
        {
            result.Title = "Input tax claimed, by GD line and purchase";
            result.Columns = Cols(("date", "Date", "date"), ("gdNumber", "GD", "text"), ("description", "Description", "text"),
                ("hsCode", "HS code", "text"), ("claimMonth", "Claim month", "text"), ("salesTax", "Sales tax", "money"),
                ("valueAddedTax", "Value-added tax", "money"), ("otherTax", "Other", "money"), ("inputTax", "Input tax", "money"));
            var rows = new List<(DateTime Date, DashboardBreakdownRowDto Row)>();
            foreach (var l in await _worksheet.CostingLinesAsync(companyId))
            {
                if (l.InputTax <= 0m || l.ClaimMonth is not DateTime c) continue;
                var cm = new DateTime(c.Year, c.Month, 1);
                if (cm < ctx.First || cm >= ctx.End) continue;
                var input = l.SalesTax + l.ValueAddedTax + l.OtherTax;
                var row = GroupRow(null, l.GdNumber + " · " + l.Description, -input,
                    ("date", l.GdDate), ("gdNumber", l.GdNumber), ("description", l.Description), ("hsCode", l.HsCode),
                    ("claimMonth", cm.ToString("yyyy-MM", Inv)), ("salesTax", Round(l.SalesTax)),
                    ("valueAddedTax", Round(l.ValueAddedTax)), ("otherTax", Round(l.OtherTax)), ("inputTax", Round(input)));
                row.Sub = "Claimed " + cm.ToString("MMM yyyy", Inv);
                rows.Add((l.GdDate ?? cm, row));
            }
            var bills = await _context.PurchaseBills.AsNoTracking()
                .Where(b => b.CompanyId == companyId && b.Date >= ctx.First && b.Date < ctx.End && b.GSTAmount != 0m)
                .Select(b => new { b.Date, b.PurchaseBillNumber, b.GSTAmount }).ToListAsync();
            foreach (var b in bills)
                rows.Add((b.Date, GroupRow(null, "Purchase bill #" + b.PurchaseBillNumber, -b.GSTAmount,
                    ("date", b.Date), ("description", "Purchase bill #" + b.PurchaseBillNumber), ("inputTax", Round(b.GSTAmount)))));
            var notes = await _context.PurchaseDebitNotes.AsNoTracking()
                .Where(n => n.CompanyId == companyId && n.Date >= ctx.First && n.Date < ctx.End && n.GSTAmount != 0m)
                .Select(n => new { n.Date, n.DebitNoteNumber, n.GSTAmount }).ToListAsync();
            foreach (var n in notes)
                rows.Add((n.Date, GroupRow(null, "Purchase debit note #" + n.DebitNoteNumber, n.GSTAmount,
                    ("date", n.Date), ("description", "Purchase debit note #" + n.DebitNoteNumber), ("inputTax", Round(-n.GSTAmount)))));
            return FillLevel2(result, rows.OrderByDescending(x => x.Date).Select(x => x.Row), -ctx.Dto.InputTaxClaimed);
        }

        // adv-tax-236: level 1 = month x section from the panel's documents; level 2 = the bills.
        private async Task<DashboardBreakdownDto> AdvTaxBreakdownAsync(
            int companyId, TaxContext ctx, string? key, DashboardBreakdownDto result)
        {
            var d = ctx.Dto;
            result.AmountLabel = "Advance tax";
            var adv = ctx.Docs.Where(x => x.AdvanceTaxSection is "236G" or "236H").ToList();
            if (key == null)
            {
                result.Title = "236G / 236H collected, by month";
                result.Note = "Advance income tax charged on bills, whole months " + d.FromMonth + " to " + d.ToMonth
                    + ". It is collected on top of the bill and paid over to FBR.";
                result.Columns = Cols(("invoices", "Documents", "number"));
                result.Rows = adv.GroupBy(x => (x.Year, x.Month, Section: x.AdvanceTaxSection!))
                    .Select(g =>
                    {
                        var m = new DateTime(g.Key.Year, g.Key.Month, 1);
                        return GroupRow(m.ToString("yyyy-MM", Inv) + ":" + g.Key.Section,
                            m.ToString("MMM yyyy", Inv) + " · " + g.Key.Section, g.Sum(x => x.Sign * x.AdvanceTaxAmount),
                            ("invoices", g.Count()));
                    })
                    .Where(r => r.Amount != 0m)
                    .OrderByDescending(r => r.GroupKey, StringComparer.Ordinal)
                    .ToList();
                result.Total = Round(d.Adv236G + d.Adv236H);
                return result;
            }

            TryAdvKey(key, out var month, out var section);
            var next = month.AddMonths(1);
            result.Title = section + " collected in " + month.ToString("MMMM yyyy", Inv);
            result.Columns = Cols(InvoiceCols);
            if (month < ctx.First || month >= ctx.End)
                return FillLevel2(result, Array.Empty<DashboardBreakdownRowDto>(), 0m);
            var list = await InvRows(DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, month, next)
                .Where(i => i.AdvanceTaxSection == section && i.AdvanceTaxAmount != 0m)).ToListAsync();
            var total = adv.Where(x => x.Year == month.Year && x.Month == month.Month && x.AdvanceTaxSection == section)
                .Sum(x => x.Sign * x.AdvanceTaxAmount);
            return FillLevel2(result, Newest(list).Select(r => InvoiceRow(r, r.Sign * r.Adv)), total);
        }

        // ── Health warnings (data gaps worth a look) ─────────────────────

        private static readonly string[] HealthKinds =
            { "health-no-receipts", "health-uncosted", "health-missing-236", "health-missing-ft", "health-no-claim-month", "health-unfiled" };

        /// <summary>Sale documents (common filter, division-scoped) that match one invoice-shaped warning.</summary>
        private async Task<IQueryable<Invoice>> HealthInvoicesAsync(
            string kind, int companyId, DashboardPeriod period, HashSet<int>? divScope)
        {
            var q = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, period.From, period.To);
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            switch (kind)
            {
                // Sections apply to sales, so notes are left out.
                case "health-missing-236":
                    return q.Where(i => i.DocumentType != 9 && i.DocumentType != 10
                        && i.Client!.RegistrationType == "Registered"
                        && (i.AdvanceTaxSection == null || i.AdvanceTaxSection == ""));
                case "health-missing-ft":
                    return q.Where(i => i.DocumentType != 9 && i.DocumentType != 10
                        && i.Client!.RegistrationType == "Unregistered" && i.FurtherTaxAmount == 0m);
                case "health-unfiled":
                    var fbr = await _context.Companies.Where(c => c.Id == companyId).Select(c => c.FbrEnabled).FirstOrDefaultAsync();
                    return fbr ? q.Where(i => !i.FbrFiledManually
                        // FbrSubmissionStatus.IsSubmittable inlined (EF cannot translate the call):
                        // Submitting / Uncertain may already be at FBR, so they are NOT "unfiled".
                        && (i.FbrStatus == null || i.FbrStatus == "" || i.FbrStatus == "Failed" || i.FbrStatus == "Validated")) : q.Where(i => false);
                case "health-no-receipts":
                    // No receipt in the period at all: every sale of the period is listed.
                    var recQ = _context.Payments.AsNoTracking()
                        .Where(p => p.CompanyId == companyId && p.Direction == PaymentDirection.Receipt && !p.IsCancelled);
                    if (period.From.HasValue) recQ = recQ.Where(p => p.Date >= period.From.Value);
                    if (period.To.HasValue) recQ = recQ.Where(p => p.Date < period.To.Value);
                    if (divScope != null)
                        recQ = recQ.Where(p => p.DivisionId == null || divScope.Contains(p.DivisionId.Value));
                    return await recQ.AnyAsync() ? q.Where(i => false) : q;
                default:
                    return q.Where(i => false);
            }
        }

        private async Task<List<GdRegisterLineDto>> GdLinesWithoutClaimMonthAsync(int companyId) =>
            await StockCostingMethod.IsGdFifoAsync(_context, companyId)
                ? (await _worksheet.CostingLinesAsync(companyId)).Where(l => l.InputTax > 0m && l.ClaimMonth == null).ToList()
                : new List<GdRegisterLineDto>();

        private async Task<List<DashboardHealthItem>> ComputeHealthAsync(
            int companyId, DashboardPeriod period, bool canSales, DashboardHeroKpis? hero, HashSet<int>? divScope)
        {
            var items = new List<DashboardHealthItem>();
            void Add(string key, string severity, int count, decimal? amount, string message)
            {
                if (count > 0) items.Add(new DashboardHealthItem { Key = key, Severity = severity, Count = count, Amount = amount, Message = message });
            }

            if (hero != null && hero.UncostedItemCount > 0)
            {
                var unc = (await LoadPositionsAsync(companyId, divScope, period.From, period.To))
                    .Where(p => p.SoldQuantity > 0m && p.ConsumedLanded == 0m).ToList();
                Add("health-uncosted", "warn", unc.Count, Round(unc.Sum(p => p.ConsumedDeclared)),
                    unc.Count + " item(s) sold with no landed cost, so their margin is overstated.");
            }
            if (!canSales) return items;

            async Task Invoices(string kind, string severity, string message)
            {
                var q = await HealthInvoicesAsync(kind, companyId, period, divScope);
                var n = await q.CountAsync();
                if (n == 0) return;
                var net = await q.SumAsync(i => (decimal?)((i.DocumentType == 10 ? -1m : 1m) * i.Subtotal)) ?? 0m;
                Add(kind, severity, n, Round(net), n + " " + message);
            }
            await Invoices("health-no-receipts", "info", "bill(s) in this period and no receipt taken in it.");
            await Invoices("health-missing-236", "warn", "bill(s) to registered buyers have no 236G/H section.");
            await Invoices("health-missing-ft", "warn", "bill(s) to unregistered buyers carry no further tax.");
            await Invoices("health-unfiled", "warn", "bill(s) not yet filed with FBR.");

            // GD input tax is company-wide: withheld from a division-restricted user.
            if (divScope == null)
            {
                var gd = await GdLinesWithoutClaimMonthAsync(companyId);
                Add("health-no-claim-month", "warn", gd.Count, Round(gd.Sum(l => l.SalesTax + l.ValueAddedTax + l.OtherTax)),
                    gd.Count + " GD line(s) have no claim month, so their input tax is not claimed.");
            }
            return items;
        }

        private async Task<(DashboardBreakdownDto? Dto, int Status, string? Error)> HealthBreakdownAsync(
            int companyId, string k, DashboardPeriod period, HashSet<int>? divScope, int? userId)
        {
            if (!HealthKinds.Contains(k)) return (null, 400, "Unknown breakdown kind.");
            var perms = userId.HasValue
                ? await _permissions.GetUserPermissionsAsync(userId.Value)
                : (IReadOnlyCollection<string>)Array.Empty<string>();
            var allowed = perms.Contains("dashboard.kpi.sales.view")
                || (k == "health-uncosted" && perms.Contains("dashboard.kpi.purchases.view"));
            if (!allowed) return (null, 403, "You do not have access to these figures.");

            var result = new DashboardBreakdownDto { Kind = k, AmountLabel = "Amount" };
            if (k == "health-uncosted")
            {
                var unc = (await LoadPositionsAsync(companyId, divScope, period.From, period.To))
                    .Where(p => p.SoldQuantity > 0m && p.ConsumedLanded == 0m)
                    .OrderByDescending(p => p.ConsumedDeclared).ToList();
                result.Title = "Items sold with no landed cost";
                result.Note = "Declared value of what left stock for items whose goods have no landed cost on file.";
                result.Columns = Cols(("qty", "Qty sold", "number"), ("declared", "Declared value", "money"));
                result.Rows = unc.Select(p =>
                {
                    var row = GroupRow(null, p.Name, p.ConsumedDeclared, ("qty", p.SoldQuantity), ("declared", Round(p.ConsumedDeclared)));
                    row.Sub = p.HsCode;
                    row.Flagged = true;
                    return row;
                }).ToList();
                result.Total = Round(unc.Sum(p => p.ConsumedDeclared));
                return (result, 200, null);
            }
            if (k == "health-no-claim-month")
            {
                if (divScope != null) return (null, 403, "GD input tax is company-wide only.");
                var gd = await GdLinesWithoutClaimMonthAsync(companyId);
                result.Title = "GD lines with no claim month";
                result.Note = "All time. Without a claim month the line's input tax is not claimed in any return.";
                result.Columns = Cols(("gdNumber", "GD", "text"), ("gdDate", "GD date", "date"), ("description", "Description", "text"),
                    ("hsCode", "HS code", "text"), ("inputTax", "Input tax", "money"));
                result.Rows = gd.OrderByDescending(l => l.GdDate).Select(l =>
                {
                    var input = l.SalesTax + l.ValueAddedTax + l.OtherTax;
                    var row = GroupRow(null, l.GdNumber + " · " + l.Description, input,
                        ("gdNumber", l.GdNumber), ("gdDate", l.GdDate), ("description", l.Description),
                        ("hsCode", l.HsCode), ("inputTax", Round(input)));
                    row.Flagged = true;
                    return row;
                }).ToList();
                result.Total = Round(gd.Sum(l => l.SalesTax + l.ValueAddedTax + l.OtherTax));
                return (result, 200, null);
            }

            var list = await InvRows(await HealthInvoicesAsync(k, companyId, period, divScope)).ToListAsync();
            result.Title = k switch
            {
                "health-no-receipts" => "Bills in a period with no receipts",
                "health-missing-236" => "Bills to registered buyers with no 236G/H",
                "health-missing-ft" => "Bills to unregistered buyers with no further tax",
                _ => "Bills not filed with FBR",
            };
            result.Columns = Cols(InvoiceCols);
            // Total is the whole set; FillLevel2 only caps the rows.
            return (FillLevel2(result, Newest(list).Select(r => InvoiceRow(r, r.Sign * r.Subtotal)),
                list.Sum(r => r.Sign * r.Subtotal)), 200, null);
        }

        private static decimal Round(decimal v) =>
            Math.Round(v, 2, MidpointRounding.AwayFromZero);

        /// <summary>
        /// Every item's position, from ONE walk. Cost of goods sold, stock on
        /// hand, dead stock, real margin, stock converted, the ageing buckets
        /// and the drill-down behind each of them all read this, so a card and
        /// its breakdown cannot disagree.
        /// </summary>
        private async Task<List<ItemStockPositions.Position>> LoadPositionsAsync(
            int companyId, HashSet<int>? divScope, DateTime? from, DateTime? to)
        {
            var inputs = await LoadPositionInputsAsync(companyId, divScope);
            return ItemStockPositions.Compute(inputs.Openings, inputs.MovementsByItem, inputs.Names, from, to, inputs.Costing);
        }

        private sealed record PositionInputs(
            Dictionary<int, ItemStockPositions.Opening> Openings,
            Dictionary<int, List<StockMovement>> MovementsByItem,
            Dictionary<int, (string Name, string? HsCode)> Names,
            StockCosting Costing);

        /// <summary>The walk's inputs, loaded once so a monthly series can cut
        /// the same walk at twelve dates without twelve loads.</summary>
        private async Task<PositionInputs> LoadPositionInputsAsync(int companyId, HashSet<int>? divScope)
        {
            var cacheKey = companyId + ":" + (divScope == null ? "*" : string.Join(",", divScope.OrderBy(x => x)));
            if (_inputsCache.TryGetValue(cacheKey, out var cached)) return cached;
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
                    g => new ItemStockPositions.Opening(
                        g.Sum(x => x.Quantity),
                        g.Sum(x => x.ValueExcludingTax),
                        g.Sum(x => x.ActualCostExcludingTax),
                        g.Max(x => x.SalesTaxRate)));

            var movementsByItem = movements
                .GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var ids = openings.Keys.Union(movementsByItem.Keys).Distinct().ToList();

            // Soft-deleted catalog rows are INCLUDED, and marked.
            //
            // The on-hand GRID hides them, which is right for a list of things
            // you can act on. Their VALUE is a different question: a delete
            // removes a catalog entry, not the goods, and the ledger's relief
            // walk never filtered them — so excluding them here put the
            // dashboard 56,358.17 below the Inventory account on one company
            // and broke the one invariant this all rests on. The stock is real;
            // the row just has no live catalog entry to point at.
            var names = await _context.ItemTypes.AsNoTracking()
                .Where(it => ids.Contains(it.Id))
                .Select(it => new { it.Id, it.Name, it.HSCode, it.IsDeleted })
                .ToDictionaryAsync(
                    x => x.Id,
                    x => (x.IsDeleted ? x.Name + " (deleted item)" : x.Name, (string?)x.HSCode));

            var costing = await StockCosting.LoadAsync(_context, companyId, ids);
            return _inputsCache[cacheKey] = new PositionInputs(openings, movementsByItem, names, costing);
        }

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

            var costing = await StockCosting.LoadAsync(_context, companyId,
                openings.Keys.Union(movementsByItem.Keys).Distinct().ToList());
            decimal total = 0m;
            foreach (var (itemTypeId, open) in openings)
                if (!movementsByItem.ContainsKey(itemTypeId))
                    total += open.ValueExcludingTax;   // never moved
            foreach (var (itemTypeId, itemMovements) in movementsByItem)
            {
                openings.TryGetValue(itemTypeId, out var open);
                var position = costing.Compute(itemTypeId,
                    open.Quantity, open.ValueExcludingTax, open.ActualCostExcludingTax,
                    open.SalesTaxRate, itemMovements);
                total += position.ValueExcludingTax;
            }
            return Math.Round(total, 2, MidpointRounding.AwayFromZero);
        }

        private async Task<(decimal TotalGross, decimal GstAmount, decimal Subtotal)> SumInvoicesAsync(
            int companyId, DateTime? from, DateTime? to, HashSet<int>? divScope)
        {
            // One definition of a sale (Helpers/DashboardSalesFilter); credit
            // notes subtract, debit notes add.
            var q = DashboardSalesFilter.SaleDocs(_context.Invoices.AsNoTracking(), companyId, from, to);
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));
            var agg = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    TotalGross = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
                    GstAmount  = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GSTAmount),
                    Subtotal   = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.Subtotal),
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
            var q = DashboardSalesFilter.SaleDocs(
                _context.Invoices.AsNoTracking(), companyId, period.From, period.To);
            // Division-RBAC scope (null = unrestricted); company-level rows
            // (DivisionId == null) stay visible - policy D1.
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));

            var aggregate = await q
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Total = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
                    // Notes adjust the total but are not extra invoices.
                    Count = g.Count(i => i.DocumentType != 9 && i.DocumentType != 10),
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
            // Ranked by NET sales (excl. tax, notes signed) — the figure the
            // sales drill adds up; GroupKey is that drill's customer key.
            var topClients = (await q
                .GroupBy(i => i.Client!.ClientGroupId ?? -i.ClientId)
                .Select(g => new
                {
                    g.Key,
                    Id = g.Min(x => x.ClientId),
                    // Every row in a real ClientGroup carries the same
                    // master Name (group sync keeps them aligned). Max
                    // is just a deterministic picker.
                    Name = g.Max(x => x.Client!.Name),
                    Value = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
                    NetValue = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.Subtotal),
                    Count = g.Count(i => i.DocumentType != 9 && i.DocumentType != 10),
                })
                .OrderByDescending(x => x.NetValue)
                // Bumped from 5 → 20 — the dashboard donut groups
                // anything beyond the top 8 into "Others" but the
                // detail list shows all 20 with exact numbers.
                .Take(20)
                .ToListAsync())
                .Select(x => new DashboardTopEntity
                {
                    Id = x.Id, Name = x.Name ?? "(unknown)", Value = x.Value, NetValue = x.NetValue, Count = x.Count,
                    GroupKey = "c:" + x.Key.ToString(CultureInfo.InvariantCulture),
                })
                .ToList();

            // Recent 5 within the period (most recent first).
            var recent = await q
                .Where(i => i.DocumentType != 9 && i.DocumentType != 10)
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
            var now = PakistanClock.Now;
            var anchor = new DateTime(now.Year, now.Month, 1);
            var earliest = anchor.AddMonths(-11);  // 12 buckets total

            var q = DashboardSalesFilter.SaleDocs(
                _context.Invoices.AsNoTracking(), companyId, earliest, anchor.AddMonths(1));
            if (divScope != null)
                q = q.Where(i => i.DivisionId == null || divScope.Contains(i.DivisionId.Value));

            var rows = await q
                .GroupBy(i => new { i.Date.Year, i.Date.Month })
                .Select(g => new
                {
                    g.Key.Year,
                    g.Key.Month,
                    Value = g.Sum(i => (i.DocumentType == 10 ? -1m : 1m) * i.GrandTotal),
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
            var now = PakistanClock.Now;
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
            }

            // Top 5 items by movement volume in the last 30 days — most
            // useful "what's actually moving" signal. SourceType doesn't
            // matter here (purchases or sales — anything that moves
            // stock counts as movement).
            var thirty = PakistanClock.Now.AddDays(-30);
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
