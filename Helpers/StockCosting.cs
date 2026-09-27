using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// How a company values its stock: the weighted average every company has
    /// always used, or FIFO by GD (<see cref="GdFifoValuation"/>).
    ///
    /// Stored per company in <see cref="SystemSetting"/> under
    /// <c>Stock.CostingMethod.{companyId}</c> rather than a new Company column:
    /// production does not apply migrations on deploy, and every query that
    /// loads a Company would fail against a column the database does not have
    /// yet. A missing row means WeightedAverage, so every existing company is
    /// untouched until someone switches it.
    /// </summary>
    public static class StockCostingMethod
    {
        public const string WeightedAverage = "WeightedAverage";
        public const string GdFifo = "GdFifo";

        public static string SettingKey(int companyId) => $"Stock.CostingMethod.{companyId}";

        public static async Task<string> GetAsync(AppDbContext db, int companyId)
        {
            var key = SettingKey(companyId);
            var value = await db.SystemSettings.AsNoTracking()
                .Where(s => s.Key == key).Select(s => s.Value).FirstOrDefaultAsync();
            return string.Equals(value, GdFifo, StringComparison.OrdinalIgnoreCase) ? GdFifo : WeightedAverage;
        }

        public static async Task<bool> IsGdFifoAsync(AppDbContext db, int companyId)
            => await GetAsync(db, companyId) == GdFifo;
    }

    /// <summary>
    /// The one place a caller turns an item's opening + movements into a
    /// <see cref="StockValuation.Position"/>, whichever method the company uses.
    /// Every surface that shows stock value (dashboard, export, movement feed,
    /// COGS relief, bill pricing) goes through here, so they cannot disagree.
    ///
    /// <see cref="None"/> is the weighted average with no database work at all:
    /// a caller holding no company context (a unit test, an internal tool)
    /// gets exactly the old behaviour.
    /// </summary>
    public sealed class StockCosting
    {
        public static readonly StockCosting None = new(false, new());

        public bool IsFifo { get; }
        private readonly Dictionary<int, GdFifoValuation.Book> _books;

        private StockCosting(bool isFifo, Dictionary<int, GdFifoValuation.Book> books)
        {
            IsFifo = isFifo;
            _books = books;
        }

        public GdFifoValuation.Book? BookFor(int itemTypeId)
            => IsFifo ? _books.GetValueOrDefault(itemTypeId) ?? new GdFifoValuation.Book() : null;

        public StockValuation.Position Compute(
            int itemTypeId,
            decimal openingQuantity, decimal openingValue, decimal openingActual, decimal openingRate,
            IEnumerable<StockMovement> movements,
            List<StockValuation.Step>? trace = null)
        {
            if (!IsFifo)
                return StockValuation.Compute(openingQuantity, openingValue, openingActual, openingRate,
                    movements, trace);
            return Detailed(itemTypeId, openingQuantity, openingValue, openingActual, openingRate,
                movements, trace).Position;
        }

        /// <summary>The FIFO walk with its pools and per-movement takes. Only
        /// meaningful when <see cref="IsFifo"/>; a weighted-average company has
        /// no pools to show.</summary>
        public GdFifoValuation.Result Detailed(
            int itemTypeId,
            decimal openingQuantity, decimal openingValue, decimal openingActual, decimal openingRate,
            IEnumerable<StockMovement> movements,
            List<StockValuation.Step>? trace = null)
            => GdFifoValuation.Compute(openingQuantity, openingValue, openingActual, openingRate,
                BookFor(itemTypeId) ?? new GdFifoValuation.Book(), movements.Select(ToFifo), trace);

        public static GdFifoValuation.Movement ToFifo(StockMovement m) => new(
            m.Id, m.MovementDate, m.Direction == StockMovementDirection.In, m.Quantity,
            m.UnitCostExcludingTax, m.ActualUnitCostExcludingTax, m.SalesTaxRate,
            m.ValueAdjustmentExcludingTax, m.ActualValueAdjustmentExcludingTax,
            m.SourceType.ToString(), m.SourceId);

        /// <summary>
        /// Loads what the FIFO walk needs for <paramref name="itemTypeIds"/>
        /// (null = every item the company holds lots or GD arrivals for). A
        /// weighted-average company costs one settings lookup and nothing else.
        /// </summary>
        public static async Task<StockCosting> LoadAsync(
            AppDbContext db, int companyId, IEnumerable<int>? itemTypeIds = null)
        {
            if (!await StockCostingMethod.IsGdFifoAsync(db, companyId)) return None;
            return await BuildAsync(db, companyId, itemTypeIds);
        }

        /// <summary>The FIFO books whatever the company's method -- for the
        /// read-only comparison asked BEFORE a company is switched.</summary>
        public static Task<StockCosting> LoadForCompareAsync(
            AppDbContext db, int companyId, IEnumerable<int>? itemTypeIds = null)
            => BuildAsync(db, companyId, itemTypeIds);

        private static async Task<StockCosting> BuildAsync(
            AppDbContext db, int companyId, IEnumerable<int>? itemTypeIds)
        {
            var ids = itemTypeIds?.Distinct().ToList();
            var books = new Dictionary<int, GdFifoValuation.Book>();
            if (ids is { Count: 0 }) return new StockCosting(true, books);

            var balancesQ = db.OpeningStockBalances.AsNoTracking().Where(b => b.CompanyId == companyId);
            if (ids != null) balancesQ = balancesQ.Where(b => ids.Contains(b.ItemTypeId));
            var balances = await balancesQ.Select(b => new
            {
                b.Id, b.ItemTypeId, b.Quantity, b.ValueExcludingTax, b.ActualCostExcludingTax,
            }).ToListAsync();
            var balanceIds = balances.Select(b => b.Id).ToList();

            var lots = balanceIds.Count == 0 ? new()
                : await db.OpeningStockLots.AsNoTracking()
                    .Where(l => balanceIds.Contains(l.OpeningStockBalanceId))
                    .Select(l => new
                    {
                        l.Id, l.OpeningStockBalanceId, l.LotRef, l.LotDate, l.ClaimMonth, l.SourceRow,
                        l.ItemNameOnSheet, l.BalanceQuantity, l.BalanceValueExcludingTax,
                        l.BalanceSalesTaxRate,
                    }).ToListAsync();

            // Landed cost the GD costing import recorded against each opening
            // balance, per GD, and the GD dates it knows.
            var costLines = balanceIds.Count == 0 ? new()
                : await db.ImportConsignmentLines.AsNoTracking()
                    .Where(l => l.OpeningStockBalanceId != null
                        && balanceIds.Contains(l.OpeningStockBalanceId.Value)
                        && l.ImportConsignment.CompanyId == companyId)
                    .Select(l => new
                    {
                        BalanceId = l.OpeningStockBalanceId!.Value,
                        l.ImportConsignment.GdNumber, l.CostExcludingTax,
                    }).ToListAsync();
            var gdDates = (await db.ImportConsignments.AsNoTracking()
                    .Where(c => c.CompanyId == companyId)
                    .Select(c => new { c.GdNumber, GdDate = (DateTime?)c.GdDate }).ToListAsync())
                .Where(c => c.GdDate.HasValue && c.GdDate.Value > DateTime.MinValue)
                .GroupBy(c => c.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.Min(c => c.GdDate), StringComparer.OrdinalIgnoreCase);
            var claimPeriods = (await db.GdClaimPeriods.AsNoTracking()
                    .Where(x => x.CompanyId == companyId)
                    .Select(x => new { x.GdNumber, x.ClaimMonth }).ToListAsync())
                .GroupBy(x => x.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => (DateTime?)g.Min(x => x.ClaimMonth), StringComparer.OrdinalIgnoreCase);

            foreach (var b in balances)
            {
                var book = books.TryGetValue(b.ItemTypeId, out var existing) ? existing
                    : books[b.ItemTypeId] = new GdFifoValuation.Book();
                var bLots = lots.Where(l => l.OpeningStockBalanceId == b.Id
                        && !string.IsNullOrWhiteSpace(l.LotRef) && l.BalanceQuantity > 0m).ToList();
                if (bLots.Count == 0) continue;

                // Landed cost per lot: a GD's recorded cost is spread over this
                // balance's lots of that GD by value; the balance's remaining
                // landed cost is spread over the lots with no recorded cost and
                // the untraced remainder, by value (CLAUDE.md 5b-17).
                var actualByLot = new Dictionary<int, decimal>();
                var byGd = costLines.Where(c => c.BalanceId == b.Id)
                    .GroupBy(c => c.GdNumber.Trim(), StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.Sum(c => c.CostExcludingTax), StringComparer.OrdinalIgnoreCase);
                var assigned = 0m;
                foreach (var g in bLots.GroupBy(l => l.LotRef!.Trim(), StringComparer.OrdinalIgnoreCase))
                {
                    if (!byGd.TryGetValue(g.Key, out var gdCost)) continue;
                    var basis = g.Sum(l => l.BalanceValueExcludingTax);
                    var list = g.ToList();
                    var left = gdCost;
                    for (var i = 0; i < list.Count; i++)
                    {
                        var share = i == list.Count - 1 ? left
                            : basis > 0m ? Math.Round(gdCost * list[i].BalanceValueExcludingTax / basis, 2)
                            : Math.Round(gdCost / list.Count, 2);
                        left -= share;
                        actualByLot[list[i].Id] = share;
                    }
                    assigned += gdCost;
                }
                var uncosted = bLots.Where(l => !actualByLot.ContainsKey(l.Id)).ToList();
                var remainder = Math.Max(0m, b.ActualCostExcludingTax - assigned);
                var untracedValue = Math.Max(0m, b.ValueExcludingTax - bLots.Sum(l => l.BalanceValueExcludingTax));
                var weight = uncosted.Sum(l => l.BalanceValueExcludingTax) + untracedValue;
                foreach (var l in uncosted)
                    actualByLot[l.Id] = weight > 0m
                        ? Math.Round(remainder * l.BalanceValueExcludingTax / weight, 2)
                        : Math.Round(remainder / uncosted.Count, 2);

                foreach (var l in bLots)
                {
                    var gd = l.LotRef!.Trim();
                    var claim = l.ClaimMonth ?? claimPeriods.GetValueOrDefault(gd);
                    book.Lots.Add(new GdFifoValuation.OpeningLot(
                        Key: $"lot-{l.Id}",
                        GdNumber: gd,
                        OrderDate: l.LotDate ?? gdDates.GetValueOrDefault(gd) ?? claim,
                        ClaimMonth: claim,
                        Quantity: l.BalanceQuantity,
                        Value: l.BalanceValueExcludingTax,
                        ActualValue: actualByLot.GetValueOrDefault(l.Id),
                        Rate: l.BalanceSalesTaxRate,
                        Tiebreak: l.SourceRow,
                        LotId: l.Id,
                        Description: l.ItemNameOnSheet));
                }
            }

            // GD lines that brought stock in as their own movement.
            var arrivalsQ = db.ImportConsignmentLines.AsNoTracking()
                .Where(l => l.StockMovementId != null && l.ImportConsignment.CompanyId == companyId
                    && l.ItemTypeId != null);
            if (ids != null) arrivalsQ = arrivalsQ.Where(l => ids.Contains(l.ItemTypeId!.Value));
            var arrivals = await arrivalsQ.Select(l => new
            {
                l.Id, ItemTypeId = l.ItemTypeId!.Value, MovementId = l.StockMovementId!.Value,
                l.ImportConsignment.GdNumber, l.ImportConsignment.GdDate, l.ClaimMonth, l.DescriptionOnSheet,
            }).ToListAsync();
            foreach (var a in arrivals)
            {
                var book = books.TryGetValue(a.ItemTypeId, out var existing) ? existing
                    : books[a.ItemTypeId] = new GdFifoValuation.Book();
                var gd = a.GdNumber.Trim();
                book.Arrivals[a.MovementId] = new GdFifoValuation.Arrival(
                    gd, a.GdDate, a.ClaimMonth ?? claimPeriods.GetValueOrDefault(gd), a.Id, a.DescriptionOnSheet);
            }

            return new StockCosting(true, books);
        }
    }
}
