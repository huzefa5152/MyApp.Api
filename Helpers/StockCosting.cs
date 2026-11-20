using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// How a company values its stock: the weighted average, or FIFO by GD
    /// (<see cref="GdFifoValuation"/>). Every company created from 2026-09-28
    /// is written <see cref="GdFifo"/> at creation (<see cref="ForNewCompany"/>);
    /// a company with no row -- every company created before that -- stays on
    /// the weighted average until someone switches it.
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

        /// <summary>The companies among <paramref name="companyIds"/> valued FIFO by GD.</summary>
        public static async Task<HashSet<int>> GdFifoCompanyIdsAsync(AppDbContext db, IEnumerable<int> companyIds)
        {
            var keys = companyIds.Distinct().ToDictionary(SettingKey);
            var rows = await db.SystemSettings.AsNoTracking()
                .Where(s => keys.Keys.Contains(s.Key)).Select(s => new { s.Key, s.Value }).ToListAsync();
            return rows.Where(r => string.Equals(r.Value, GdFifo, StringComparison.OrdinalIgnoreCase))
                .Select(r => keys[r.Key]).ToHashSet();
        }

        /// <summary>
        /// Whether an invoice is REFUSED for selling beyond stock (2026-11-21,
        /// maintainer's decision). Never under FIFO by GD: importers sell goods
        /// whose GD has not landed yet, the item goes negative, and the GD
        /// settles those sales first when it arrives -- the walk is built for
        /// it. The invoice forms still warn. Elsewhere it is the company's
        /// "block selling beyond stock" switch, as before.
        /// </summary>
        public static bool BlocksSaleBeyondStock(Company company, bool gdFifo)
            => company.InventoryTrackingEnabled && company.StockGuardHardBlock && !gdFifo;

        /// <summary>The method a NEW company starts on.</summary>
        public const string ForNewCompany = GdFifo;

        /// <summary>Writes the company's method (upsert). The caller saves nothing
        /// else here; this saves its own row.</summary>
        public static async Task SetAsync(AppDbContext db, int companyId, string method, int? userId = null)
        {
            var key = SettingKey(companyId);
            var row = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == key);
            if (row == null)
                db.SystemSettings.Add(new SystemSetting
                {
                    Key = key,
                    Value = method,
                    UpdatedAt = DateTime.UtcNow,
                    UpdatedByUserId = userId,
                });
            else
            {
                row.Value = method; row.UpdatedAt = DateTime.UtcNow; row.UpdatedByUserId = userId;
            }
            await db.SaveChangesAsync();
        }
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

        /// <summary>
        /// Invoices ENTERED after this feature shipped take their AMOUNT out of
        /// stock, not their quantity (CLAUDE.md 5b-24) -- every FIFO-by-GD
        /// company, old and new. Every invoice that existed before keeps the
        /// quantity rule it was reconciled under, whatever its date, so no
        /// matched figure moves (maintainer's decision, 2026-11-17). The
        /// boundary is the highest invoice id at the first start of this code,
        /// written once by Program.cs under this key; no row = nothing sells by
        /// value yet.
        /// </summary>
        public const string SaleByValueAfterKey = "Stock.SaleByValueAfterInvoiceId";

        /// <summary>The last invoice id that still takes out its quantity; null
        /// before the watermark is written.</summary>
        public static async Task<int?> SaleByValueAfterAsync(AppDbContext db)
        {
            var v = await db.SystemSettings.AsNoTracking()
                .Where(s => s.Key == SaleByValueAfterKey).Select(s => s.Value).FirstOrDefaultAsync();
            return int.TryParse(v, out var id) ? id : null;
        }

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
        /// (null = every item the company holds lots, GD arrivals or sales by value for). A
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
                b.Id,
                b.ItemTypeId,
                b.Quantity,
                b.ValueExcludingTax,
                b.ActualCostExcludingTax,
            }).ToListAsync();
            var balanceIds = balances.Select(b => b.Id).ToList();

            var lots = balanceIds.Count == 0 ? new()
                : await db.OpeningStockLots.AsNoTracking()
                    .Where(l => balanceIds.Contains(l.OpeningStockBalanceId))
                    .Select(l => new
                    {
                        l.Id,
                        l.OpeningStockBalanceId,
                        l.LotRef,
                        l.LotDate,
                        l.ClaimMonth,
                        l.SourceRow,
                        l.ItemNameOnSheet,
                        l.BalanceQuantity,
                        l.BalanceValueExcludingTax,
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
                        l.ImportConsignment.GdNumber,
                        l.CostExcludingTax,
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
                l.Id,
                ItemTypeId = l.ItemTypeId!.Value,
                MovementId = l.StockMovementId!.Value,
                l.ImportConsignment.GdNumber,
                l.ImportConsignment.GdDate,
                l.ClaimMonth,
                l.DescriptionOnSheet,
            }).ToListAsync();
            foreach (var a in arrivals)
            {
                var book = books.TryGetValue(a.ItemTypeId, out var existing) ? existing
                    : books[a.ItemTypeId] = new GdFifoValuation.Book();
                var gd = a.GdNumber.Trim();
                book.Arrivals[a.MovementId] = new GdFifoValuation.Arrival(
                    gd, a.GdDate, a.ClaimMonth ?? claimPeriods.GetValueOrDefault(gd), a.Id, a.DescriptionOnSheet);
            }

            // Restatements: the GD lines an item was restated to (CLAUDE.md 5b-17).
            var restateQ = db.StockRestatementLines.AsNoTracking().Where(l => l.CompanyId == companyId);
            if (ids != null) restateQ = restateQ.Where(l => ids.Contains(l.ItemTypeId));
            var restated = await restateQ.ToListAsync();
            foreach (var l in restated)
            {
                var book = books.TryGetValue(l.ItemTypeId, out var existing) ? existing
                    : books[l.ItemTypeId] = new GdFifoValuation.Book();
                if (!book.Restatements.TryGetValue(l.StockMovementId, out var list))
                    book.Restatements[l.StockMovementId] = list = new();
                var gd = l.GdNumber.Trim();
                var claim = l.ClaimMonth ?? claimPeriods.GetValueOrDefault(gd);
                list.Add(new GdFifoValuation.OpeningLot(
                    Key: $"restate-{l.Id}", GdNumber: gd,
                    OrderDate: l.GdDate ?? gdDates.GetValueOrDefault(gd) ?? claim,
                    ClaimMonth: claim, Quantity: l.Quantity, Value: l.ValueExcludingTax,
                    ActualValue: l.ActualValueExcludingTax, Rate: l.SalesTaxRate,
                    Tiebreak: l.SourceRow, LotId: null, Description: l.Description));
            }

            // Invoices entered after the watermark take out their AMOUNT
            // (CLAUDE.md 5b-24): each movement's share of its lines' amount, by
            // quantity. A note follows the invoice it adjusts, so a return on
            // an invoice that took out its quantity puts back quantity.
            var after = await SaleByValueAfterAsync(db) ?? int.MaxValue;
            var saleQ = db.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId
                    && m.SourceType == StockMovementSourceType.Invoice
                    && m.SourceId != null && m.SourceId > after
                    && db.Invoices.Any(i => i.Id == m.SourceId
                        && (i.OriginalInvoiceId == null || i.OriginalInvoiceId > after)));
            if (ids != null) saleQ = saleQ.Where(m => ids.Contains(m.ItemTypeId));
            var saleMoves = await saleQ.Select(m => new { m.Id, InvoiceId = m.SourceId!.Value, m.ItemTypeId, m.Quantity })
                .ToListAsync();
            if (saleMoves.Count > 0)
            {
                var invoiceIds = saleMoves.Select(m => m.InvoiceId).Distinct().ToList();
                var amounts = (await db.InvoiceItems.AsNoTracking()
                        .Where(i => invoiceIds.Contains(i.InvoiceId) && i.ItemTypeId != null && !i.KeepInStock)
                        .Select(i => new { i.InvoiceId, ItemTypeId = i.ItemTypeId!.Value, i.LineTotal })
                        .ToListAsync())
                    .GroupBy(i => (i.InvoiceId, i.ItemTypeId))
                    .ToDictionary(g => g.Key, g => g.Sum(i => i.LineTotal));
                foreach (var g in saleMoves.GroupBy(m => (m.InvoiceId, m.ItemTypeId)))
                {
                    if (!amounts.TryGetValue(g.Key, out var total) || total <= 0m) continue;
                    var book = books.TryGetValue(g.Key.ItemTypeId, out var existing) ? existing
                        : books[g.Key.ItemTypeId] = new GdFifoValuation.Book();
                    var list = g.OrderBy(m => m.Id).ToList();
                    var qty = list.Sum(m => m.Quantity);
                    var left = total;
                    for (var i = 0; i < list.Count; i++)
                    {
                        var share = i == list.Count - 1 ? left
                            : qty > 0m ? Math.Round(total * list[i].Quantity / qty, 2) : 0m;
                        left -= share;
                        if (share > 0m) book.SaleValues[list[i].Id] = share;
                    }
                }
            }

            return new StockCosting(true, books);
        }

        /// <summary>
        /// Stores on each sale-by-value movement (CLAUDE.md 5b-24) the quantity
        /// its amount bought in the FIFO walk, so every screen that adds up
        /// movement quantities agrees with the walk. The walk itself ignores
        /// the stored quantity of such a movement, so this is idempotent.
        /// Call after anything that changes what an item's sales draw on.
        /// </summary>
        public static async Task RederiveSaleQuantitiesAsync(AppDbContext db, int companyId, IEnumerable<int>? itemTypeIds)
        {
            var ids = itemTypeIds?.Distinct().ToList();
            if (ids is { Count: 0 }) return;
            var costing = await LoadAsync(db, companyId, ids);
            if (!costing.IsFifo) return;
            ids = costing._books.Where(kv => kv.Value.SaleValues.Count > 0 && (ids == null || ids.Contains(kv.Key)))
                .Select(kv => kv.Key).ToList();
            if (ids.Count == 0) return;

            var openings = await db.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId && ids.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Qty = g.Sum(o => o.Quantity),
                    Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax),
                    Rate = g.Max(o => o.SalesTaxRate),
                })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x);
            var movements = await db.StockMovements
                .Where(m => m.CompanyId == companyId && ids.Contains(m.ItemTypeId))
                .ToListAsync();
            var changed = false;
            foreach (var g in movements.GroupBy(m => m.ItemTypeId))
            {
                var open = openings.GetValueOrDefault(g.Key);
                var walk = costing.Detailed(g.Key,
                    open?.Qty ?? 0m, open?.Value ?? 0m, open?.ActualCost ?? 0m, open?.Rate ?? 0m, g);
                foreach (var m in g)
                {
                    if (!walk.SaleQuantities.TryGetValue(m.Id, out var q)) continue;
                    q = Math.Round(q, 4);   // StockMovement.Quantity is decimal(18,4)
                    if (q > 0m && q != m.Quantity) { m.Quantity = q; changed = true; }
                }
            }
            if (changed) await db.SaveChangesAsync();
        }

    }
}
