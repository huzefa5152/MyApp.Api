// Offline harness for FIFO-by-GD stock costing (Helpers/GdFifoValuation.cs).
// Rules: CLAUDE.md section 5b-17.
//
//   cd scripts/stock_fifo_harness && dotnet run -c Release
//
// Every case also checks the walk's own invariants after it runs:
//   quantity  = opening + in - out
//   value     = opening value + ValueIn - ValueOut
//   value     = what the pools hold - the unsettled shortfall
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using static MyApp.Api.Helpers.GdFifoValuation;

int passed = 0, failed = 0;
void Check(string name, bool ok, string detail = "")
{
    if (ok) passed++; else { failed++; Console.WriteLine($"FAIL  {name}  {detail}"); }
}
bool Near(decimal a, decimal b, decimal tol = 0.011m) => Math.Abs(a - b) <= tol;

DateTime D(int y, int m, int d = 1) => new(y, m, d);
OpeningLot Lot(string key, string gd, DateTime? date, DateTime? claim, decimal qty, decimal value,
    decimal actual = 0m, decimal rate = 18m, int row = 1)
    => new(key, gd, date, claim, qty, value, actual, rate, row, null, $"line {key}");
Movement Out(int id, DateTime date, decimal qty, int? src = null, string type = "Invoice")
    => new(id, date, false, qty, null, null, null, null, null, type, src ?? id);
Movement In(int id, DateTime date, decimal qty, decimal? unit = null, int? src = null,
    string type = "PurchaseBill", decimal? actualUnit = null, decimal? rate = null)
    => new(id, date, true, qty, unit, actualUnit, rate, null, null, type, src ?? id);
Movement Reval(int id, DateTime date, decimal delta, decimal? actualDelta = null)
    => new(id, date, true, 0m, null, null, null, delta, actualDelta, "Revaluation", null);

Result Run(string name, decimal oq, decimal ov, Book book, IEnumerable<Movement> moves,
    decimal oa = 0m, decimal rate = 18m)
{
    var list = moves.ToList();
    var r = GdFifoValuation.Compute(oq, ov, oa, rate, book, list);
    var p = r.Position;
    var qIn = list.Where(m => m.IsIn && m.ValueDelta is null or 0m && m.ActualDelta is null or 0m).Sum(m => m.Quantity);
    var qOut = list.Where(m => !m.IsIn).Sum(m => m.Quantity);
    Check($"{name}: quantity = opening + in - out", Near(p.Quantity, oq + qIn - qOut, 0.0001m),
        $"{p.Quantity} vs {oq + qIn - qOut}");
    Check($"{name}: value = opening + in - out", Near(p.ValueExcludingTax, ov + p.ValueIn - p.ValueOut, 0.03m),
        $"{p.ValueExcludingTax} vs {ov + p.ValueIn - p.ValueOut}");
    Check($"{name}: value = pools - shortfall",
        Near(p.ValueExcludingTax, r.Pools.Sum(x => x.Value) - r.ShortfallValue, 0.03m));
    return r;
}
Pool P(Result r, string key) => r.Pools.Single(p => p.Key == key);
List<string> Order(Result r, int movementId) => r.Takes[movementId].Select(t => t.PoolKey).ToList();

// 1. Claimed before unclaimed, whatever the GD dates.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 10, 1000),
        Lot("B", "GD-B", D(2025, 6), D(2026, 3), 10, 1500) }
    };
    var r = Run("claimed-first", 20, 2500, book, new[] { Out(1, D(2026, 4, 10), 5) });
    Check("claimed-first: sale takes the claimed GD", Order(r, 1).SequenceEqual(new[] { "B" }));
    Check("claimed-first: costed at the claimed GD's cost", r.Takes[1][0].Value == 750m);
}

// 2. Invoice-month rule: a claim month AFTER the sale does not count.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 10, 1000),
        Lot("B", "GD-B", D(2025, 6), D(2026, 6), 10, 1500) }
    };
    var r = Run("invoice-month", 20, 2500, book, new[] {
        Out(1, D(2026, 4, 10), 5),     // B not claimed yet in April -> oldest (A)
        Out(2, D(2026, 6, 15), 5) });  // B claimed in June -> B
    Check("invoice-month: April sale ignores a June claim", Order(r, 1).SequenceEqual(new[] { "A" }));
    Check("invoice-month: June sale uses the claimed GD", Order(r, 2).SequenceEqual(new[] { "B" }));
    Check("invoice-month: claimed in the sale's own month counts",
        GdFifoValuation.ClaimedFor(P(r, "B"), D(2026, 6)));
}

// 3. Oldest GD date first within the claimed group, then within unclaimed.
{
    var book = new Book
    {
        Lots = {
        Lot("C2", "GD-C2", D(2025, 9), D(2026, 1), 5, 500),
        Lot("C1", "GD-C1", D(2025, 2), D(2026, 1), 5, 400),
        Lot("U2", "GD-U2", D(2025, 8), null, 5, 600),
        Lot("U1", "GD-U1", D(2025, 3), null, 5, 700) }
    };
    var r = Run("order", 20, 2200, book, new[] { Out(1, D(2026, 2), 20) });
    Check("order: claimed oldest, claimed newer, unclaimed oldest, unclaimed newer",
        Order(r, 1).SequenceEqual(new[] { "C1", "C2", "U1", "U2" }), string.Join(",", Order(r, 1)));
    Check("order: all drained, value exactly zero", r.Position.ValueExcludingTax == 0m);
}

// 4. A sale bigger than the claimed stock spills into the unclaimed GD.
{
    var book = new Book
    {
        Lots = {
        Lot("C", "GD-C", D(2025, 5), D(2026, 1), 6, 600),
        Lot("U", "GD-U", D(2025, 1), null, 10, 2000) }
    };
    var r = Run("spill", 16, 2600, book, new[] { Out(1, D(2026, 3), 10) });
    Check("spill: claimed first, then unclaimed", Order(r, 1).SequenceEqual(new[] { "C", "U" }));
    Check("spill: 6 from claimed, 4 from unclaimed",
        r.Takes[1][0].Quantity == 6m && r.Takes[1][1].Quantity == 4m);
    Check("spill: cost 600 + 4 x 200", r.Takes[1].Sum(t => t.Value) == 1400m);
    Check("spill: unclaimed GD keeps 6 worth 1200", P(r, "U").Quantity == 6m && P(r, "U").Value == 1200m);
}

// 5. Opening stock whose GD is dated after the sale is still available.
{
    var book = new Book { Lots = { Lot("L", "GD-L", D(2026, 8, 22), null, 10, 1000) } };
    var r = Run("gd-after-sale", 10, 1000, book, new[] { Out(1, D(2026, 7, 5), 4) });
    Check("gd-after-sale: no shortfall", r.ShortfallQuantity == 0m);
    Check("gd-after-sale: taken from the lot", Order(r, 1).SequenceEqual(new[] { "L" }));
}

// 6. Undated lots sort after dated ones, then by sheet row.
{
    var book = new Book
    {
        Lots = {
        Lot("N2", "GD-N2", null, null, 5, 500, row: 9),
        Lot("N1", "GD-N1", null, null, 5, 500, row: 3),
        Lot("D", "GD-D", D(2026, 1), null, 5, 500, row: 20) }
    };
    var r = Run("undated", 15, 1500, book, new[] { Out(1, D(2026, 2), 15) });
    Check("undated: dated first, then by row", Order(r, 1).SequenceEqual(new[] { "D", "N1", "N2" }),
        string.Join(",", Order(r, 1)));
}

// 7. Opening quantity no GD explains is its own pool, used after every GD.
{
    var book = new Book { Lots = { Lot("G", "GD-G", D(2026, 1), null, 60, 6000) } };
    var r = Run("untraced", 100, 9000, book, new[] { Out(1, D(2026, 2), 70) });
    Check("untraced: pool of 40 worth 3000 exists",
        P(r, UntracedKey).InQuantity == 40m && P(r, UntracedKey).InValue == 3000m);
    Check("untraced: GD first, then untraced", Order(r, 1).SequenceEqual(new[] { "G", UntracedKey }));
    Check("untraced: cost 6000 + 10 x 75", r.Takes[1].Sum(t => t.Value) == 6750m);
}

// 8. Selling past every pool never refuses; the next arrival settles it.
{
    var book = new Book { Lots = { Lot("G", "GD-G", D(2026, 1), null, 10, 1000) } };
    var r = Run("shortfall", 10, 1000, book, new[] {
        Out(1, D(2026, 2), 15),
        In(2, D(2026, 3), 10, unit: 120m) });
    Check("shortfall: sale applied in full", r.Takes[1].Sum(t => t.Quantity) == 15m);
    Check("shortfall: uncovered 5 costed at the last pool (100)",
        r.Takes[1].Any(t => t.PoolKey == ShortfallKey && t.Quantity == 5m && t.Value == 500m));
    Check("shortfall: settled by the arrival", r.ShortfallQuantity == 0m);
    Check("shortfall: 5 left at the new cost", r.Position.Quantity == 5m && r.Position.ValueExcludingTax == 600m,
        $"{r.Position.Quantity} / {r.Position.ValueExcludingTax}");
    var mid = Run("shortfall-open", 10, 1000, book, new[] { Out(1, D(2026, 2), 15) });
    Check("shortfall-open: quantity goes negative, as today", mid.Position.Quantity == -5m);
}

// 8b. The settled cost is reported on the purchase's step, so the monthly
// relief can post it (the purchase itself is skipped there).
{
    var book = new Book { Lots = { Lot("G", "GD-G", D(2026, 1), null, 10, 1000) } };
    var trace = new List<StockValuation.Step>();
    GdFifoValuation.Compute(10, 1000, 0, 18, book, new[] {
        Out(1, D(2026, 2), 15), In(2, D(2026, 3), 10, unit: 120m) }, trace);
    var settle = trace.Single(s => s.MovementId == 2);
    Check("settled: the purchase reports 5 x (120 - 100) = 100 of cost settled",
        settle.SettledValue == 100m, $"{settle.SettledValue}");
    Check("settled: a sale reports none", trace.Single(s => s.MovementId == 1).SettledValue == 0m);
}

// 9. A downward adjustment drains pools in the same order as a sale.
{
    var book = new Book
    {
        Lots = {
        Lot("U", "GD-U", D(2025, 1), null, 10, 1000),
        Lot("C", "GD-C", D(2025, 5), D(2026, 1), 10, 2000) }
    };
    var r = Run("adjust-down", 20, 3000, book, new[] { Out(1, D(2026, 2), 12, type: "Adjustment") });
    Check("adjust-down: claimed first", Order(r, 1).SequenceEqual(new[] { "C", "U" }));
}

// 10. A sale return goes back into the pool that sale drained last.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), D(2025, 12), 6, 600),
        Lot("B", "GD-B", D(2025, 2), D(2025, 12), 10, 2000) }
    };
    var r = Run("return", 16, 2600, book, new[] {
        Out(1, D(2026, 1), 10, src: 77),
        In(2, D(2026, 1, 5), 3, src: 77, type: "Invoice") });
    Check("return: goes back to B (taken last)", Order(r, 2).SequenceEqual(new[] { "B" }));
    Check("return: at B's own cost", r.Takes[2][0].Value == 600m);
    Check("return: B holds 9, consumed 1", P(r, "B").Quantity == 9m && P(r, "B").ConsumedQuantity == 1m);
    Check("return: A untouched by the return", P(r, "A").Quantity == 0m && P(r, "A").ConsumedQuantity == 6m);
}

// 11. A revaluation is spread over what is held, in proportion to value.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 10, 600),
        Lot("B", "GD-B", D(2025, 2), null, 10, 400) }
    };
    var r = Run("reval", 20, 1000, book, new[] { Reval(1, D(2026, 1), 100m) });
    Check("reval: 60 / 40 split", P(r, "A").Value == 660m && P(r, "B").Value == 440m);
    var down = Run("reval-down", 20, 1000, book, new[] { Reval(1, D(2026, 1), -1500m) });
    Check("reval-down: no pool below zero", down.Pools.All(p => p.Value >= 0m));
}

// 12. Awkward rounding still empties to exactly zero.
{
    var book = new Book { Lots = { Lot("A", "GD-A", D(2025, 1), null, 3, 100) } };
    var r = Run("empty", 3, 100, book, new[] { Out(1, D(2026, 1), 1), Out(2, D(2026, 1), 1), Out(3, D(2026, 1), 1) });
    Check("empty: value exactly 0", r.Position.ValueExcludingTax == 0m);
    Check("empty: consumed exactly the opening", P(r, "A").ConsumedValue == 100m);
}

// 13. An item with ONE pool values exactly as the weighted average.
{
    var moves = new[] {
        Out(1, D(2026, 1, 3), 7), In(2, D(2026, 1, 9), 5, type: "Adjustment"),
        Out(3, D(2026, 2, 1), 11), Out(4, D(2026, 2, 7), 2) };
    var wa = StockValuation.Compute(40m, 733.33m, 500m, 18m, moves.Select(m => new StockMovement
    {
        Id = m.Id,
        MovementDate = m.Date,
        Quantity = m.Quantity,
        Direction = m.IsIn ? StockMovementDirection.In : StockMovementDirection.Out,
        SourceType = Enum.Parse<StockMovementSourceType>(m.SourceType),
        SourceId = m.SourceId,
    }));
    var r = Run("single-pool", 40, 733.33m, new Book(), moves, oa: 500m);
    Check("single-pool: quantity equals weighted average", r.Position.Quantity == wa.Quantity);
    Check("single-pool: value equals weighted average (to the paisa)",
        Near(r.Position.ValueExcludingTax, wa.ValueExcludingTax, 0.02m),
        $"{r.Position.ValueExcludingTax} vs {wa.ValueExcludingTax}");
    Check("single-pool: actual cost equals weighted average",
        Near(r.Position.ActualValueExcludingTax, wa.ActualValueExcludingTax, 0.02m));
}

// 14. Pools open at exactly the opening balance's money.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 10, 1000.40m),
        Lot("B", "GD-B", D(2025, 2), null, 10, 999.00m) }
    };
    var r = Run("normalise", 20, 2000m, book, Array.Empty<Movement>());
    Check("normalise: pools total the opening value", r.Pools.Sum(p => p.Value) == 2000m);
    Check("normalise: no figure moves before anything is sold", r.Position.ValueExcludingTax == 2000m);
}

// 15. Lots claiming more than the opening holds are scaled to it.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 30, 3000),
        Lot("B", "GD-B", D(2025, 2), null, 10, 1000) }
    };
    var r = Run("scale", 20, 2000m, book, Array.Empty<Movement>());
    Check("scale: quantity is the opening's", r.Position.Quantity == 20m);
    Check("scale: pools keep their proportions", P(r, "A").Quantity == 15m && P(r, "B").Quantity == 5m);
}

// 15b. A ratio that does not terminate (real data: 3 lots over an opening of
// 160.9368) still scales to the opening exactly, and quantity after sales is
// the weighted average's to the last decimal.
{
    var book = new Book
    {
        Lots = {
        Lot("A", "GD-A", D(2025, 1), null, 55m, 5500),
        Lot("B", "GD-B", D(2025, 2), null, 55m, 5500),
        Lot("C", "GD-C", D(2025, 3), null, 55m, 5500) }
    };
    var moves = new[] { Out(1, D(2026, 1), 33.3333m), Out(2, D(2026, 2), 100.0001m) };
    var r = Run("scale-exact", 160.9368m, 16093.68m, book, moves);
    Check("scale-exact: pools open at exactly the opening quantity",
        r.Pools.Sum(p => p.InQuantity) == 160.9368m, $"{r.Pools.Sum(p => p.InQuantity)}");
    Check("scale-exact: quantity is exactly opening - out", r.Position.Quantity == 160.9368m - 133.3334m,
        $"{r.Position.Quantity}");
}

// 16. Landed cost leaves from exactly the pools the selling value left from.
{
    var book = new Book
    {
        Lots = {
        Lot("C", "GD-C", D(2025, 5), D(2026, 1), 10, 1000, actual: 500),
        Lot("U", "GD-U", D(2025, 1), null, 10, 1000, actual: 900) }
    };
    var r = Run("actual", 20, 2000m, book, new[] { Out(1, D(2026, 2), 4) }, oa: 1400m);
    Check("actual: landed cost out = 4 x 50", r.Takes[1][0].ActualValue == 200m);
    Check("actual: landed cost held = 300 + 900", r.Position.ActualValueExcludingTax == 1200m);
}

// 17. A 0% lot under a taxed item takes the item's rate; the item's rate is value-weighted.
{
    var book = new Book
    {
        Lots = {
        Lot("Z", "GD-Z", D(2025, 1), null, 10, 1000, rate: 0m),
        Lot("T", "GD-T", D(2025, 2), null, 10, 1000, rate: 25m) }
    };
    var r = Run("rate", 20, 2000m, book, Array.Empty<Movement>(), rate: 18m);
    Check("rate: 0% lot uses the item's 18%", P(r, "Z").Rate == 18m);
    Check("rate: item rate weighted 21.5%", r.Position.SalesTaxRate == 21.5m, $"{r.Position.SalesTaxRate}");
    Check("rate: sales tax = sum per pool (180 + 250)", r.Position.SalesTax == 430m, $"{r.Position.SalesTax}");
}

// 18. A GD arrival is a GD pool (claimed rules apply); a purchase is not.
{
    var book = new Book
    {
        Lots = { Lot("U", "GD-U", D(2025, 1), null, 5, 500) },
        Arrivals = { [2] = new Arrival("GD-NEW", D(2026, 2, 1), D(2026, 2), 901, "arrived") },
    };
    var r = Run("arrival", 5, 500, book, new[] {
        In(2, D(2026, 2, 3), 10, unit: 150m, type: "Adjustment"),
        In(3, D(2026, 2, 4), 10, unit: 50m),
        Out(4, D(2026, 3), 12) });
    Check("arrival: pool is a GD arrival", P(r, "arrival-901").Kind == PoolKind.GdArrival);
    Check("arrival: claimed arrival, then unclaimed GD, purchase last",
        Order(r, 4).SequenceEqual(new[] { "arrival-901", "U" }), string.Join(",", Order(r, 4)));
}

// 19. What the NEXT sale would take, for pricing a bill line.
{
    var book = new Book
    {
        Lots = {
        Lot("U", "GD-U", D(2025, 1), null, 5, 500),
        Lot("C", "GD-C", D(2025, 6), D(2026, 5), 5, 700) }
    };
    var r = Run("next", 10, 1200, book, Array.Empty<Movement>());
    Check("next: in April the unclaimed older GD comes first",
        GdFifoValuation.NextConsumption(r, D(2026, 4, 20)).Select(p => p.Key).SequenceEqual(new[] { "U", "C" }));
    Check("next: in May the claimed GD comes first",
        GdFifoValuation.NextConsumption(r, D(2026, 5, 2)).Select(p => p.Key).SequenceEqual(new[] { "C", "U" }));
}

// 21. A restatement: from that movement the item holds exactly the sheet's GD
// lines -- nothing sold, value moved to the lines, quantity untouched.
{
    var book = new Book
    {
        Lots = {
            Lot("A", "GD-A", D(2025, 1), D(2026, 1), 10, 1000),
            Lot("B", "GD-B", D(2025, 2), null, 10, 500) },
        Restatements = { [2] = new List<OpeningLot> {
            new("restate-1", "GD-X", D(2025, 6), D(2026, 8), 8, 1200, 800, 18, 4, null, "x"),
            new("restate-2", "GD-Y", D(2025, 3), null, 7, 700, 400, 25, 5, null, "y") } },
    };
    var r = Run("restate", 20, 1500, book, new[] {
        Out(1, D(2026, 8, 3), 5),
        Reval(2, D(2026, 9, 28), 0m),
        Out(3, D(2026, 9, 29), 10) }, oa: 900m);
    Check("restate: quantity untouched by the restatement", r.Position.Quantity == 5m, $"{r.Position.Quantity}");
    Check("restate: the old pools were replaced, not sold",
        P(r, "A").ConsumedQuantity == 5m && P(r, "A").RestatedAwayQuantity == 5m
        && P(r, "B").ConsumedQuantity == 0m && P(r, "B").RestatedAwayQuantity == 10m);
    Check("restate: the next sale uses the sheet's claimed GD first",
        Order(r, 3).SequenceEqual(new[] { "restate-1", "restate-2" }), string.Join(",", Order(r, 3)));
    Check("restate: 8 x 150 + 2 x 100 = 1,400 costed", r.Takes[3].Sum(t => t.Value) == 1400m,
        $"{r.Takes[3].Sum(t => t.Value)}");
    Check("restate: left = 5 of GD-Y worth 500", P(r, "restate-2").Quantity == 5m && P(r, "restate-2").Value == 500m);
    Check("restate: landed cost follows the lines", r.Position.ActualValueExcludingTax == 400m * 5m / 7m
        || Math.Abs(r.Position.ActualValueExcludingTax - 285.71m) <= 0.01m, $"{r.Position.ActualValueExcludingTax}");
    var only = Run("restate-only", 20, 1500, book, new[] { Out(1, D(2026, 8, 3), 5), Reval(2, D(2026, 9, 28), 0m) });
    Check("restate-only: value is exactly the lines' total", only.Position.ValueExcludingTax == 1900m,
        $"{only.Position.ValueExcludingTax}");
    Check("restate-only: rate is the lines' value-weighted rate",
        Math.Abs(only.Position.SalesTaxRate - (1200m * 18 + 700m * 25) / 1900m) < 0.0001m);
}

// 22. Lines that no longer add up to on-hand are scaled to it; a shortfall is cleared.
{
    var book = new Book
    {
        Lots = { Lot("A", "GD-A", D(2025, 1), null, 10, 1000) },
        Restatements = { [2] = new List<OpeningLot> {
            new("restate-1", "GD-X", D(2025, 6), null, 6, 600, 0, 18, 1, null, null),
            new("restate-2", "GD-Y", D(2025, 7), null, 6, 1200, 0, 18, 2, null, null) } },
    };
    var r = Run("restate-scale", 10, 1000, book, new[] { Reval(2, D(2026, 9, 1), 0m) });
    Check("restate-scale: pools add up to on-hand exactly", r.Pools.Where(p => p.Kind == PoolKind.Restated).Sum(p => p.Quantity) == 10m);
    var s = Run("restate-short", 10, 1000, book, new[] { Out(1, D(2026, 8, 1), 12), Reval(2, D(2026, 9, 1), 0m) });
    Check("restate-short: shortfall cleared, nothing on hand, value zero",
        s.ShortfallQuantity == 0m && s.Position.Quantity == -2m && s.Pools.All(p => p.Quantity == 0m));
}

// 23. A sale dated BEFORE a restatement but entered after it (Alpha, GLASS
// CHATTON 7018.1000, 2026-10-08): the restatement's lines hold more than is on
// hand, and the difference leaves them FIFO -- the claimed, oldest GD first --
// never pro rata. Pro rata costed the 2,937 KG at the sheet's average (496.74)
// against the first GD's 473.36, and took 68,479 too much out of stock.
{
    var book = new Book
    {
        Restatements = { [5] = new List<OpeningLot> {
            new("r-11115", "KAPE-HC-11115", D(2026, 9, 8), D(2026, 9), 11450, 5420021.00m, 5164639.40m, 18, 47, null, "glass"),
            new("r-11568", "KAPE-HC-11568", D(2026, 9, 10), D(2026, 9), 4831, 2667479.50m, 2541792.69m, 18, 61, null, "glass") } },
    };
    var moves = new[] {
        Out(1, D(2026, 8, 1), 2100),                       // bill 51
        Out(2, D(2026, 9, 4), 2937),                       // bill 101, typed on 8 Oct
        In(3, D(2026, 9, 8), 11450, 473.3643m, type: "ImportConsignment"),
        In(4, D(2026, 9, 10), 4831, 552.1589m, type: "ImportConsignment"),
        Reval(5, D(2026, 9, 30), -0.39m) };
    var r = Run("restate-backdated", 2100, 1162456.17m, book, moves, oa: 996391m);
    Check("restate-backdated: on hand 13,344", r.Position.Quantity == 13344m, $"{r.Position.Quantity}");
    Check("restate-backdated: the 2,937 left the claimed, oldest GD",
        P(r, "r-11115").Quantity == 8513m && P(r, "r-11568").Quantity == 4831m,
        $"{P(r, "r-11115").Quantity} / {P(r, "r-11568").Quantity}");
    Check("restate-backdated: valued FIFO, not at the sheet's average",
        r.Position.ValueExcludingTax == 6697229.61m, $"{r.Position.ValueExcludingTax}");
    Check("restate-backdated: the later GD keeps its whole value", P(r, "r-11568").Value == 2667479.50m);
    Check("restate-backdated: the drained units read as consumed, not replaced",
        P(r, "r-11115").ConsumedQuantity == 2937m && P(r, "r-11115").RestatedAwayQuantity == 0m);
    var next = GdFifoValuation.NextConsumption(r, D(2026, 10, 8));
    Check("restate-backdated: the next sale still starts on GD 11115 at 473.36",
        next[0].Key == "r-11115" && Math.Abs(next[0].Value / next[0].Quantity - 473.3643m) < 0.0001m,
        $"{next[0].Key} {next[0].Value / next[0].Quantity}");
}

// 24. The mirror: stock dated BEFORE a restatement but entered after it (a GD
// arrival the sheet never saw). It keeps its own GD and cost beside the
// sheet's lines instead of being smeared over them pro rata.
{
    var book = new Book
    {
        Lots = { Lot("A", "GD-A", D(2026, 1), null, 10, 1000) },
        Restatements = { [2] = new List<OpeningLot> {
            new("r-X", "GD-X", D(2026, 2), null, 10, 1200, 0, 18, 1, null, null) } },
    };
    var r = Run("restate-late-arrival", 10, 1000, book, new[] {
        Reval(2, D(2026, 9, 30), 0m),
        In(3, D(2026, 9, 15), 5, 200m) });
    Check("restate-late-arrival: the sheet line stays exactly as stated",
        P(r, "r-X").Quantity == 10m && P(r, "r-X").Value == 1200m, $"{P(r, "r-X").Quantity} {P(r, "r-X").Value}");
    Check("restate-late-arrival: the arrival keeps its own 5 at 200",
        P(r, "move-3").Quantity == 5m && P(r, "move-3").Value == 1000m, $"{P(r, "move-3").Quantity} {P(r, "move-3").Value}");
    Check("restate-late-arrival: the opening the sheet replaced is gone",
        P(r, "A").Quantity == 0m && P(r, "A").RestatedAwayQuantity == 10m);
    Check("restate-late-arrival: value 2,200", r.Position.ValueExcludingTax == 2200m, $"{r.Position.ValueExcludingTax}");
}

// 20. A value-only revaluation on an empty item holds nothing.
{
    var r = Run("reval-empty", 0, 0, new Book(), new[] { Reval(1, D(2026, 1), 50m) });
    Check("reval-empty: stays zero", r.Position.ValueExcludingTax == 0m);
}

// 21. A late GD is added WHOLE, as the consultant's stock sheet adds it, and
//     sales entered late come off the sheet's lines first (AY, Oct 2026).
{
    var match = D(2026, 10, 18);
    MyApp.Api.DTOs.FifoRestatementLineDto Sheet(string gd, DateTime on, decimal q, decimal v) => new()
    {
        ItemTypeId = 5829,
        GdNumber = gd,
        GdDate = on,
        ClaimMonth = D(2026, 6),
        Quantity = q,
        ValueExcludingTax = v,
        SalesTaxRate = 18
    };
    var sheet = new List<MyApp.Api.DTOs.FifoRestatementLineDto> {
        Sheet("KAPW-HC-116986", D(2025, 12, 26), 2502.676491561680m, 438698.33m),
        Sheet("KAPW-HC-173918", D(2026, 3, 25), 1331m, 1039493m),
        Sheet("KAPW-HC-197973", D(2026, 5, 9), 175m, 893491.67m) };
    var late = new List<BackdatedGdRestatement.LateLine> { new(5829, "KAPW-HC-65465", D(2026, 10, 12),
        D(2026, 10), 7, "WASHING MACHINE PARTS", 660m, 376940.67m, 18m) };
    // 2,811 sold on 13 Oct, entered on 14 Nov: on hand on the match date is 4,008.68 + 660 - 2,811.
    var lines = BackdatedGdRestatement.BuildLines(5829, match, sheet, late, 4008.676491561680m + 660m - 2811m);
    Check("late-gd-whole: the GD is added whole", lines.Single(l => l.GdNumber == "KAPW-HC-65465").Quantity == 660m);
    Check("late-gd-whole: the sale comes off the oldest sheet line first",
        lines.All(l => l.GdNumber != "KAPW-HC-116986")
        && Math.Abs(lines.Single(l => l.GdNumber == "KAPW-HC-173918").Quantity - 1022.676491561680m) < 0.0001m,
        string.Join(", ", lines.Select(l => $"{l.GdNumber} {l.Quantity}")));
    Check("late-gd-whole: the plan equals on-hand", Math.Abs(lines.Sum(l => l.Quantity) - 1857.676491561680m) < 0.0001m);

    // Sold more than the sheet held (gate valve: sheet 3,660, GD 4,450, sold 4,531):
    // the sheet is used up and the GD stays whole, so the plan is above on-hand and
    // the restatement leaves this item out instead of revaluing it off the sheet.
    var valve = BackdatedGdRestatement.BuildLines(7816, match,
        new List<MyApp.Api.DTOs.FifoRestatementLineDto> { new() { ItemTypeId = 7816, GdNumber = "KAPE-HC-6575",
            GdDate = D(2026, 8, 8), Quantity = 3660m, ValueExcludingTax = 2149215.83m, SalesTaxRate = 18m } },
        new List<BackdatedGdRestatement.LateLine> { new(7816, "KAPW-HC-65465", D(2026, 10, 12), D(2026, 10), 16,
            "VALVE", 4450m, 1497476.17m, 18m) }, 3579m);
    Check("late-gd-oversold: only the GD is left, whole", valve.Count == 1 && valve[0].Quantity == 4450m
        && valve[0].ValueExcludingTax == 1497476.17m);
    Check("late-gd-oversold: above on-hand, so the restatement will refuse it", valve.Sum(l => l.Quantity) > 3579m);
}

// 25. What an invoice line priced from an amount takes out of stock
//     (2026-11-15). The invoice bills whole units; stock gives up what the
//     amount buys, so the value that leaves is the amount billed.
{
    bool Throws(Action a) { try { a(); return false; } catch (InvalidOperationException) { return true; } }

    // One machine worth 250,000; 30,000 of it is billed.
    var machine = new List<MyApp.Api.Helpers.StockOutQuantity.Tier> { new(1m, 250000m, 250000m) };
    var part = MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(30000m, 1m, 250000m, 250000m, machine, decimalUnit: false)!.Value;
    Check("stock-qty: part of a unit bills 1 whole unit", part.Quantity == 1m && part.UnitPrice == 30000m && !part.CloseOut);
    Check("stock-qty: and takes out what the amount buys", part.StockQuantity == 0.12m);

    // The FIFO walk then costs the sale at the amount, and leaves the rest.
    var walk = GdFifoValuation.Compute(1m, 250000m, 0m, 18m, new GdFifoValuation.Book(), new[]
    {
        new GdFifoValuation.Movement(1, D(2026, 10, 5), false, part.StockQuantity!.Value, null, null, null, null, null, "Invoice", 1),
    });
    Check("stock-qty: the walk costs the sale at the amount billed", Math.Abs(walk.Takes[1].Sum(t => t.Value) - 30000m) < 0.01m,
        $"{walk.Takes[1].Sum(t => t.Value)}");
    Check("stock-qty: the rest of the unit stays, at its value", Math.Abs(walk.Position.ValueExcludingTax - 220000m) < 0.01m
        && walk.Position.Quantity == 0.88m, $"{walk.Position.Quantity} / {walk.Position.ValueExcludingTax}");
    var whole = GdFifoValuation.Compute(1m, 250000m, 0m, 18m, new GdFifoValuation.Book(), new[]
    {
        new GdFifoValuation.Movement(1, D(2026, 10, 5), false, 1m, null, null, null, null, null, "Invoice", 1),
    });
    Check("stock-qty: a whole unit typed by hand still takes the whole unit", whole.Position.ValueExcludingTax == 0m);

    // Across two GDs: the amount drains the first and part of the second.
    var two = new List<MyApp.Api.Helpers.StockOutQuantity.Tier> { new(10m, 1000m, 100m), new(20m, 1000m, 50m) };
    Check("stock-qty: quantity walks the GDs in order", MyApp.Api.Helpers.StockOutQuantity.QuantityForAmount(1260m, 100m, two) == 15.2m);
    var crossed = MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(1260m, 30m, 2000m, 100m, two, false)!.Value;
    Check("stock-qty: rounded down on the invoice, fraction kept for stock", crossed.Quantity == 15m && crossed.StockQuantity == 15.2m
        && Math.Round(crossed.Quantity * crossed.UnitPrice, 2) == 1260m);
    Check("stock-qty: past the last GD its cost continues", MyApp.Api.Helpers.StockOutQuantity.QuantityForAmount(2500m, 100m, two) == 40m);
    Check("stock-qty: weighted average prices at the one cost", MyApp.Api.Helpers.StockOutQuantity.QuantityForAmount(250m, 100m, null) == 2.5m);

    var exact = MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(500m, 30m, 2000m, 100m, two, false)!.Value;
    Check("stock-qty: an amount that buys whole units carries none", exact.Quantity == 5m && exact.StockQuantity == null);

    // The whole bin stays the close-out case: rounded up, no stock quantity.
    var bin = MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(317028.67m, 331.9597m, 317028.67m, 955.0215m, null, false)!.Value;
    Check("stock-qty: billing the whole bin rounds up and is settled by the close-out", bin.CloseOut && bin.Quantity == 332m && bin.StockQuantity == null);
    var binKg = MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(317028.67m, 331.9597m, 317028.67m, 955.0215m, null, true)!.Value;
    Check("stock-qty: a decimal unit bills the exact bin", binKg.CloseOut && binKg.Quantity == 331.9597m);

    Check("stock-qty: nothing on hand cannot be priced", MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(100m, 0m, 0m, 0m, null, false) == null);
    Check("stock-qty: stock with no value cannot be priced", MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(100m, 5m, 0m, 0m, null, false) == null);
    Check("stock-qty: no amount cannot be priced", MyApp.Api.Helpers.StockOutQuantity.PriceFromAmount(0m, 5m, 500m, 100m, null, false) == null);

    // What a caller may send.
    Check("stock-qty: none sent -> billed quantity leaves", MyApp.Api.Helpers.StockOutQuantity.Resolve(null, 5m) == null
        && MyApp.Api.Helpers.StockOutQuantity.Of(null, 5m) == 5m);
    Check("stock-qty: zero or negative clears", MyApp.Api.Helpers.StockOutQuantity.Resolve(0m, 5m) == null
        && MyApp.Api.Helpers.StockOutQuantity.Resolve(-1m, 5m) == null);
    Check("stock-qty: equal to the billed quantity stores nothing", MyApp.Api.Helpers.StockOutQuantity.Resolve(5m, 5m) == null);
    Check("stock-qty: within a unit is kept", MyApp.Api.Helpers.StockOutQuantity.Resolve(4.6m, 5m) == 4.6m
        && MyApp.Api.Helpers.StockOutQuantity.Of(4.6m, 5m) == 4.6m);
    Check("stock-qty: a whole unit away is refused", Throws(() => MyApp.Api.Helpers.StockOutQuantity.Resolve(4m, 5m))
        && Throws(() => MyApp.Api.Helpers.StockOutQuantity.Resolve(6m, 5m)) && Throws(() => MyApp.Api.Helpers.StockOutQuantity.Resolve(50m, 5m)));

    // Edits.
    Check("stock-qty edit: an untouched line keeps what it had", MyApp.Api.Helpers.StockOutQuantity.AfterEdit(null, 0.12m, true, 1m) == 0.12m);
    Check("stock-qty edit: a changed line with none sent goes back to the billed quantity",
        MyApp.Api.Helpers.StockOutQuantity.AfterEdit(null, 0.12m, false, 3m) == null);
    Check("stock-qty edit: a new one replaces it", MyApp.Api.Helpers.StockOutQuantity.AfterEdit(2.4m, 0.12m, false, 2m) == 2.4m);
    Check("stock-qty edit: zero clears it", MyApp.Api.Helpers.StockOutQuantity.AfterEdit(0m, 0.12m, true, 1m) == null);
    Check("stock-qty edit: a bad one is refused", Throws(() => MyApp.Api.Helpers.StockOutQuantity.AfterEdit(9m, 0.12m, true, 1m)));

    // A credit note returns its share of what the sale took, not whole units.
    Check("stock-qty note: a full return brings back what left", MyApp.Api.Helpers.StockOutQuantity.Share(0.12m, 1m, 1m) == 0.12m);
    Check("stock-qty note: a partial return brings back its share", MyApp.Api.Helpers.StockOutQuantity.Share(15.2m, 15m, 3m) == 3.04m);
    Check("stock-qty note: a line without one returns its own quantity", MyApp.Api.Helpers.StockOutQuantity.Share(null, 15m, 3m) == null);
}

Console.WriteLine($"{passed + failed} checks, {failed} failed");
return failed == 0 ? 0 : 1;
