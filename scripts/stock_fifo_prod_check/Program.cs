// READ-ONLY production check for FIFO by GD (2026-09-28).
//
//   dotnet build MyApp.Api.csproj
//   cd scripts/stock_fifo_prod_check && dotnet run -- [--env feat/importer-ledger-receipts]
//
// Reads the connection from the gitignored production.databases.json and runs
// the SHIPPED code (StockCosting + StockValuation + GdFifoValuation, linked
// from the built MyApp.Api.dll) over every company's real stock. SELECT only;
// SaveChanges is never called. It answers three questions:
//   1. Is anything on production switched to FIFO? (It must not be until the
//      maintainer switches a company, so every new bill still costs exactly as
//      it did.)
//   2. Does the FIFO walk hold its invariants on real data -- same quantity as
//      the weighted average for every item, value = what the pools hold, every
//      sale fully allocated?
//   3. What would switching each company do, and what would its next bill use?
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

var env = "feat/importer-ledger-receipts";
for (var i = 0; i < args.Length - 1; i++) if (args[i] == "--env") env = args[i + 1];

var cfgPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "production.databases.json"));
if (!File.Exists(cfgPath)) { Console.WriteLine($"FATAL: {cfgPath} not found"); return 2; }
using var cfg = JsonDocument.Parse(File.ReadAllText(cfgPath));
var cs = cfg.RootElement.GetProperty("environments").GetProperty(env).GetProperty("connectionString").GetString()!
         + ";ApplicationIntent=ReadOnly;Command Timeout=300";

var options = new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(cs)
    .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking).Options;
await using var db = new AppDbContext(options);

int fails = 0;
void Check(string what, bool ok, string detail = "")
{
    if (!ok) { fails++; Console.WriteLine($"   FAIL {what} {detail}"); }
}
string M(decimal v) => v.ToString("#,##0.00");

var companies = await db.Companies.Select(c => new { c.Id, c.Name }).OrderBy(c => c.Id).ToListAsync();
var settings = await db.SystemSettings.Where(s => s.Key.StartsWith("Stock.CostingMethod."))
    .Select(s => new { s.Key, s.Value }).ToListAsync();
Console.WriteLine($"Environment {env}: {companies.Count} companies, {settings.Count} costing-method settings");
foreach (var s in settings) Console.WriteLine($"   setting {s.Key} = {s.Value}");

foreach (var co in companies)
{
    var openings = await db.OpeningStockBalances.Where(o => o.CompanyId == co.Id)
        .GroupBy(o => o.ItemTypeId)
        .Select(g => new
        {
            ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity), Value = g.Sum(o => o.ValueExcludingTax),
            Actual = g.Sum(o => o.ActualCostExcludingTax), Rate = g.Max(o => o.SalesTaxRate),
        }).ToDictionaryAsync(x => x.ItemTypeId);
    var moves = await db.StockMovements.Where(m => m.CompanyId == co.Id).ToListAsync();
    var byItem = moves.GroupBy(m => m.ItemTypeId).ToDictionary(g => g.Key, g => g.ToList());
    var ids = openings.Keys.Union(byItem.Keys).Distinct().ToList();
    if (ids.Count == 0) continue;

    // 1. The method production will use for this company's NEXT bill.
    var live = await StockCosting.LoadAsync(db, co.Id, ids);
    var method = await StockCostingMethod.GetAsync(db, co.Id);

    // 2 + 3. Both walks over the same real rows.
    var fifo = await StockCosting.LoadForCompareAsync(db, co.Id, ids);
    decimal waValue = 0, fValue = 0, waOut = 0, fOut = 0, waAct = 0, fAct = 0;
    int changed = 0, withGd = 0, shortItems = 0, untracedItems = 0;
    var preview = new List<(string Name, decimal Value, List<GdFifoValuation.Pool> Tiers)>();
    var names = await db.ItemTypes.Where(i => ids.Contains(i.Id)).Select(i => new { i.Id, i.Name })
        .ToDictionaryAsync(i => i.Id, i => i.Name);

    foreach (var id in ids)
    {
        var o = openings.GetValueOrDefault(id);
        var ms = byItem.GetValueOrDefault(id) ?? new List<StockMovement>();
        var wa = StockValuation.Compute(o?.Qty ?? 0, o?.Value ?? 0, o?.Actual ?? 0, o?.Rate ?? 0, ms);
        var liveP = live.Compute(id, o?.Qty ?? 0, o?.Value ?? 0, o?.Actual ?? 0, o?.Rate ?? 0, ms);
        var fr = fifo.Detailed(id, o?.Qty ?? 0, o?.Value ?? 0, o?.Actual ?? 0, o?.Rate ?? 0, ms);
        var f = fr.Position;
        var name = names.GetValueOrDefault(id, $"item {id}");

        if (method == StockCostingMethod.WeightedAverage)
            Check($"[{co.Id}] {name}: the live path is still the weighted average",
                liveP == wa, $"{liveP.ValueExcludingTax} vs {wa.ValueExcludingTax}");
        Check($"[{co.Id}] {name}: same quantity on both methods", f.Quantity == wa.Quantity,
            $"{f.Quantity} vs {wa.Quantity}");
        Check($"[{co.Id}] {name}: value = what the pools hold",
            Math.Abs(f.ValueExcludingTax - (fr.Pools.Sum(p => p.Value) - fr.ShortfallValue)) <= 0.05m,
            $"{f.ValueExcludingTax} vs {fr.Pools.Sum(p => p.Value) - fr.ShortfallValue}");
        Check($"[{co.Id}] {name}: value = opening + in - out",
            Math.Abs(f.ValueExcludingTax - ((o?.Value ?? 0) + f.ValueIn - f.ValueOut)) <= 0.05m);
        Check($"[{co.Id}] {name}: no pool below zero", fr.Pools.All(p => p.Quantity >= 0 && p.Value >= 0));
        foreach (var m in ms.Where(m => m.Direction == StockMovementDirection.Out && m.Quantity > 0))
            Check($"[{co.Id}] {name}: movement {m.Id} fully allocated",
                fr.Takes.TryGetValue(m.Id, out var t) && Math.Abs(t.Sum(x => x.Quantity) - m.Quantity) < 0.0001m);
        if (ms.Count == 0)
            Check($"[{co.Id}] {name}: untouched item values identically",
                Math.Abs(f.ValueExcludingTax - wa.ValueExcludingTax) <= 0.01m,
                $"{f.ValueExcludingTax} vs {wa.ValueExcludingTax}");

        waValue += wa.ValueExcludingTax; fValue += f.ValueExcludingTax;
        waOut += wa.ValueOut; fOut += f.ValueOut;
        waAct += wa.ActualValueExcludingTax; fAct += f.ActualValueExcludingTax;
        if (Math.Abs(f.ValueExcludingTax - wa.ValueExcludingTax) > 0.01m) changed++;
        if (fr.Pools.Any(p => p.GdNumber != null)) withGd++;
        if (fr.ShortfallQuantity > 0) shortItems++;
        if (fr.Pools.Any(p => p.Kind == GdFifoValuation.PoolKind.OpeningUntraced)) untracedItems++;
        if (f.Quantity > 0 && fr.Pools.Count(p => p.GdNumber != null) > 1)
            preview.Add((name, f.ValueExcludingTax, GdFifoValuation.NextConsumption(fr, PakistanClock.Today)));
    }

    Console.WriteLine($"\n[{co.Id}] {co.Name}  method={method}  items={ids.Count}  with GD lots={withGd}");
    Console.WriteLine($"   next bill costs with: {(live.IsFifo ? "FIFO by GD" : "weighted average (unchanged)")}");
    Console.WriteLine($"   stock value   WA {M(waValue),18}   FIFO {M(fValue),18}   diff {M(fValue - waValue)}");
    Console.WriteLine($"   cost of sales WA {M(waOut),18}   FIFO {M(fOut),18}   diff {M(fOut - waOut)}");
    Console.WriteLine($"   landed held   WA {M(waAct),18}   FIFO {M(fAct),18}   diff {M(fAct - waAct)}");
    Console.WriteLine($"   items valued differently {changed}; sold past stock {shortItems}; opening not traced to a GD {untracedItems}");
    foreach (var (n, v, tiers) in preview.OrderByDescending(p => p.Value).Take(3))
        Console.WriteLine($"   next sale of {n}: " + string.Join(" -> ", tiers.Take(4).Select(t =>
            $"GD {t.GdNumber ?? "-"}{(GdFifoValuation.ClaimedFor(t, new DateTime(PakistanClock.Today.Year, PakistanClock.Today.Month, 1)) ? "*" : "")} {t.Quantity:0.####}@{(t.Quantity > 0 ? t.Value / t.Quantity : 0):0.##}")));
}

Console.WriteLine(fails == 0 ? "\nALL INVARIANTS HOLD" : $"\n{fails} FAILURES");
return fails == 0 ? 0 : 1;
