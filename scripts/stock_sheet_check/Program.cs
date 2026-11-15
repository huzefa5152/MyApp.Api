// READ-ONLY reader of one company's stock, for comparing with a consultant's sheet.
//
//   dotnet build MyApp.Api.csproj
//   cd scripts/stock_sheet_check
//   dotnet run -c Release -- "<part of the company name>" <yyyy-MM> <out.json> [--local]
//
// Runs the SHIPPED FIFO walk (StockCosting, linked from the built MyApp.Api.dll)
// over the company's real rows and writes, per item: the position and GD pools at
// the start of the month, at its end and now, every movement with the cost it
// took out, and the month's invoices with each line's amount beside its stock cost.
// SELECT only: SaveChanges is never called and the connection asks for read intent.
//
// The connection comes from the gitignored production.databases.json (importer
// line), or with --local from local.databases.json. Nothing about it is printed.
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

if (args.Length < 3) { Console.Error.WriteLine("usage: <company name part> <yyyy-MM> <out.json> [--local]"); return 2; }
var frag = args[0];
var monthStart = DateTime.ParseExact(args[1], "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture);
var monthEnd = monthStart.AddMonths(1);
var outPath = args[2];
var local = args.Contains("--local");
const string Line = "feat/importer-ledger-receipts";

var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", ".."));
var cfgPath = Path.Combine(root, local ? "local.databases.json" : "production.databases.json");
if (!File.Exists(cfgPath)) { Console.Error.WriteLine($"FATAL: {Path.GetFileName(cfgPath)} not found in the repository root"); return 2; }
using var cfg = JsonDocument.Parse(File.ReadAllText(cfgPath));
var cs = local
    ? cfg.RootElement.GetProperty("connectionTemplate").GetString()!
        .Replace("{server}", cfg.RootElement.GetProperty("server").GetString())
        .Replace("{database}", cfg.RootElement.GetProperty("branches").GetProperty(Line).GetString())
    : cfg.RootElement.GetProperty("environments").GetProperty(Line).GetProperty("connectionString").GetString()!;
cs = cs.TrimEnd(';') + ";ApplicationIntent=ReadOnly;Command Timeout=300";

var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(cs)
    .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking).Options);

var companies = await db.Companies.Where(c => c.Name.Contains(frag)).Select(c => new { c.Id, c.Name }).ToListAsync();
if (companies.Count != 1)
{
    Console.Error.WriteLine($"FATAL: \"{frag}\" matches {companies.Count} companies: {string.Join(", ", companies.Select(c => c.Name))}");
    return 2;
}
var co = companies[0];
var method = await StockCostingMethod.GetAsync(db, co.Id);
Console.Error.WriteLine($"company {co.Id} {co.Name}; costing {method}; month {monthStart:yyyy-MM}; {(local ? "LOCAL" : "PRODUCTION, read only")}");

var openings = await db.OpeningStockBalances.Where(o => o.CompanyId == co.Id).GroupBy(o => o.ItemTypeId)
    .Select(g => new
    {
        ItemTypeId = g.Key,
        Qty = g.Sum(o => o.Quantity),
        Value = g.Sum(o => o.ValueExcludingTax),
        Actual = g.Sum(o => o.ActualCostExcludingTax),
        Rate = g.Max(o => o.SalesTaxRate)
    })
    .ToDictionaryAsync(x => x.ItemTypeId);
var moves = await db.StockMovements.Where(m => m.CompanyId == co.Id).ToListAsync();
var ids = openings.Keys.Union(moves.Select(m => m.ItemTypeId)).Distinct().ToList();
var items = await db.ItemTypes.Where(i => ids.Contains(i.Id)).Select(i => new { i.Id, i.Name, i.HSCode, i.UOM })
    .ToDictionaryAsync(i => i.Id);
var costing = await StockCosting.LoadAsync(db, co.Id, ids);

var cuts = new (string Key, DateTime? Before)[] { ("start", monthStart), ("end", monthEnd), ("now", null) };
var costOut = new Dictionary<int, decimal>();
var totals = cuts.ToDictionary(c => c.Key, _ => (Value: 0m, Tax: 0m));
var outItems = new List<object>();
foreach (var id in ids)
{
    var o = openings.GetValueOrDefault(id);
    var ms = moves.Where(m => m.ItemTypeId == id).ToList();
    var per = new Dictionary<string, object>();
    foreach (var (key, before) in cuts)
    {
        var sub = before == null ? ms : ms.Where(m => m.MovementDate < before).ToList();
        var r = costing.Detailed(id, o?.Qty ?? 0, o?.Value ?? 0, o?.Actual ?? 0, o?.Rate ?? 0, sub);
        if (key == "now") foreach (var t in r.Takes) costOut[t.Key] = t.Value.Sum(x => x.Value);
        var p = r.Position;
        totals[key] = (totals[key].Value + p.ValueExcludingTax, totals[key].Tax + p.ValueExcludingTax * p.SalesTaxRate / 100m);
        per[key] = new
        {
            qty = p.Quantity,
            value = p.ValueExcludingTax,
            rate = p.SalesTaxRate,
            shortQty = r.ShortfallQuantity,
            shortValue = r.ShortfallValue,
            pools = r.Pools.Where(x => x.Quantity != 0m || x.Value != 0m).Select(x => new
            {
                kind = x.Kind.ToString(),
                gd = x.GdNumber,
                date = x.OrderDate,
                claim = x.ClaimMonth,
                desc = x.Description,
                rate = x.Rate,
                q = x.Quantity,
                v = x.Value,
            }),
        };
    }
    var it = items.GetValueOrDefault(id);
    outItems.Add(new
    {
        id,
        name = it?.Name,
        hs = it?.HSCode,
        uom = it?.UOM,
        per,
        moves = ms.Where(m => m.MovementDate >= monthStart.AddMonths(-1)).OrderBy(m => m.MovementDate).ThenBy(m => m.Id).Select(m => new
        {
            m.Id,
            date = m.MovementDate,
            entered = m.CreatedAt,
            dir = m.Direction.ToString(),
            qty = m.Quantity,
            unitCost = m.UnitCostExcludingTax,
            valueChange = m.ValueAdjustmentExcludingTax,
            source = m.SourceType.ToString(),
            sourceId = m.SourceId,
            notes = m.Notes,
            costOut = costOut.GetValueOrDefault(m.Id),
        }),
    });
}
foreach (var (key, _) in cuts)
    Console.Error.WriteLine($"stock at {key,-5}: value {totals[key].Value:#,##0.00}  sales tax {totals[key].Tax:#,##0.00}");

var invoices = await db.Invoices.Where(i => i.CompanyId == co.Id && i.Date >= monthStart && i.Date < monthEnd && !i.IsCancelled)
    .Select(i => new
    {
        i.Id,
        i.InvoiceNumber,
        i.Date,
        i.CreatedAt,
        i.Subtotal,
        i.DocumentType,
        i.IsDemo,
        i.FbrStatus,
        Items = i.Items.Select(x => new { x.ItemTypeId, x.Description, x.Quantity, x.StockQuantity, x.UnitPrice, x.LineTotal, x.UOM, x.HSCode, x.KeepInStock }).ToList()
    })
    .ToListAsync();
var invOut = invoices.OrderBy(i => i.InvoiceNumber).Select(i => new
{
    i.Id,
    number = i.InvoiceNumber,
    date = i.Date,
    entered = i.CreatedAt,
    subtotal = i.Subtotal,
    documentType = i.DocumentType,
    demo = i.IsDemo,
    fbr = i.FbrStatus,
    lines = i.Items.Select(x => new
    {
        itemTypeId = x.ItemTypeId,
        description = x.Description,
        quantity = x.Quantity,
        stockQuantity = x.StockQuantity,
        unitPrice = x.UnitPrice,
        amount = x.LineTotal,
        uom = x.UOM,
        hs = x.HSCode,
        keptInStock = x.KeepInStock,
        costOut = moves.Where(m => m.SourceType == StockMovementSourceType.Invoice && m.SourceId == i.Id && m.ItemTypeId == x.ItemTypeId).Sum(m => costOut.GetValueOrDefault(m.Id)),
        leftStock = moves.Where(m => m.SourceType == StockMovementSourceType.Invoice && m.SourceId == i.Id && m.ItemTypeId == x.ItemTypeId).Sum(m => m.Quantity),
    }),
}).ToList();
Console.Error.WriteLine($"{ids.Count} items, {moves.Count} movements, {invoices.Count} invoices in the month totalling {invoices.Sum(i => i.Subtotal):#,##0.00}");

File.WriteAllText(outPath, JsonSerializer.Serialize(new { company = co.Name, month = args[1], costing = method.ToString(), items = outItems, invoices = invOut }));
return 0;
