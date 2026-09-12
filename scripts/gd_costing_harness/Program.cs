using MyApp.Api.Helpers;
using MyApp.Api.Helpers.ExcelImport;
using static MyApp.Api.Helpers.ImportCostingCalculator;

var failures = new List<string>();
var checks = 0;

void Check(string name, decimal actual, decimal expected, decimal tolerance = 0.005m)
{
    checks++;
    if (Math.Abs(actual - expected) > tolerance)
        failures.Add($"{name}: expected {expected}, got {actual}");
}

// Alpha Traders GD KAPW-HC-8876 row 3 — SCREW DRIVER, the reference case.
// Every figure below is read off the client's own workbook.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        AssessedValue: 62490m, CustomsDuty: 0m, Acd: 0m, RegulatoryDuty: 0m,
        Others: 0m, SalesTaxRate: 18m, AstRate: 3m, IncomeTaxRate: 6m,
        AddOnProfit: 0m));

    Check("alpha.cost", r.Cost, 62490m);
    Check("alpha.salesTax", r.SalesTax, 11248.20m);
    Check("alpha.ast", r.Ast, 1874.70m);
    Check("alpha.subtotal", r.Subtotal, 75612.90m);
    Check("alpha.incomeTax", r.IncomeTax, 4536.77m);
    Check("alpha.inputTax", r.InputTax, 13122.90m);
    Check("alpha.sellingValue", r.SellingValue, 72905.00m);
}

// A line carrying every duty — Alpha row 9, so the Cost sum is exercised.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        105665m, 14085m, 2113m, 6340m, 0m, 18m, 3m, 6m, 0m));
    Check("duties.cost", r.Cost, 128203m);
    Check("duties.sellingValue", r.SellingValue, 149570.17m);
}

// Selling value is cost x (1 + ast/st). At 18/3 that is exactly 7/6.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        600000m, 0m, 0m, 0m, 0m, 18m, 3m, 6m, 0m));
    Check("ratio.sellingValue", r.SellingValue, 700000m);
}

// Add-on profit lands on top of the derived value, never inside it.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        600000m, 0m, 0m, 0m, 0m, 18m, 3m, 6m, 50000m));
    Check("addon.sellingValue", r.SellingValue, 750000m);
}

// Others enters the subtotal (and so income tax) but never the selling value:
// selling value derives from input tax, which derives from Cost alone.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 5000m, 18m, 3m, 6m, 0m));
    Check("others.subtotal", r.Subtotal, 126000m);
    Check("others.incomeTax", r.IncomeTax, 7560.00m);
    Check("others.sellingValue", r.SellingValue, 116666.67m);
}

// A zero sales-tax rate cannot divide. Selling value falls back to cost plus
// add-on rather than throwing or returning zero.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 0m, 0m, 6m, 2500m));
    Check("zerorate.salesTax", r.SalesTax, 0m);
    Check("zerorate.sellingValue", r.SellingValue, 102500m);
}

// No AST means no uplift: selling value is cost plus add-on.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 18m, 0m, 6m, 0m));
    Check("noast.sellingValue", r.SellingValue, 100000m);
}

// A 25% line — PAK carries these, and the uplift must follow the rate.
{
    var r = ImportCostingCalculator.Compute(new ImportCostingInput(
        100000m, 0m, 0m, 0m, 0m, 25m, 3m, 6m, 0m));
    Check("rate25.sellingValue", r.SellingValue, 112000m);
}

void CheckRate(string name, decimal? actual, decimal? expected)
{
    checks++;
    if (actual is null != expected is null
        || (actual is not null && Math.Abs(actual.Value - expected!.Value) > 0.0001m))
        failures.Add($"{name}: expected {expected?.ToString() ?? "null"}, got {actual?.ToString() ?? "null"}");
}

// PAK writes the rate as a fraction in a numeric cell.
CheckRate("rate.fraction", PercentRate.ToPercent(0.18m, "0.18"), 18m);
CheckRate("rate.fractionAst", PercentRate.ToPercent(0.03m, "0.03"), 3m);

// Alpha and AY write AST as the literal text "3%". CellNumber reads that as
// 0.03, i.e. already a fraction.
CheckRate("rate.percentText", PercentRate.ToPercent(null, "3%"), 3m);
CheckRate("rate.percentText18", PercentRate.ToPercent(null, "18%"), 18m);

// AY writes the income tax rate as the whole number 6, meaning 6%.
CheckRate("rate.whole", PercentRate.ToPercent(6m, "6"), 6m);
CheckRate("rate.whole25", PercentRate.ToPercent(25m, "25"), 25m);

// Zero is a real rate, not a missing one.
CheckRate("rate.zero", PercentRate.ToPercent(0m, "0"), 0m);

// A blank or non-numeric cell has no rate at all.
CheckRate("rate.blank", PercentRate.ToPercent(null, ""), null);
CheckRate("rate.text", PercentRate.ToPercent(null, "n/a"), null);

// Exactly 1 is ambiguous - 1% or 100%. Treated as the fraction, because every
// rate these sheets carry is written as a fraction or a whole number above 1,
// and 100% is a rate that exists while 1% is not one any of them use.
CheckRate("rate.one", PercentRate.ToPercent(1m, "1"), 100m);

void CheckStr(string name, string actual, string expected)
{
    checks++;
    if (actual != expected) failures.Add($"{name}: expected \"{expected}\", got \"{actual}\"");
}
void CheckBool(string name, bool actual, bool expected)
{
    checks++;
    if (actual != expected) failures.Add($"{name}: expected {expected}, got {actual}");
}

// HS codes arrive decorated. Alpha writes "8205.4000:-".
CheckStr("hs.suffix", GdCostingMapping.CleanHsCode("8205.4000:-"), "8205.4000");
CheckStr("hs.plain", GdCostingMapping.CleanHsCode("7018.1000"), "7018.1000");
CheckStr("hs.spaces", GdCostingMapping.CleanHsCode("  9405.1110 "), "9405.1110");
CheckStr("hs.trailingDot", GdCostingMapping.CleanHsCode("8481.1000."), "8481.1000");
CheckStr("hs.null", GdCostingMapping.CleanHsCode(null), "");

// A TOTALS row carries a GD number and a summed cost but no description and no
// selling value. Alpha row 30 holds 18,816,870 - the sum of the 26 lines above
// it - and importing it would double the consignment.
CheckBool("totals.alphaRow30", GdCostingMapping.LooksLikeTotalsRow("", 0m), true);
CheckBool("totals.nullBoth", GdCostingMapping.LooksLikeTotalsRow(null, null), true);

// A real line always has a description. Both halves of the test are required:
// a genuine zero-value line must still import.
CheckBool("totals.zeroValueLine", GdCostingMapping.LooksLikeTotalsRow("SCREW DRIVER", 0m), false);
CheckBool("totals.realLine", GdCostingMapping.LooksLikeTotalsRow("SCREW DRIVER", 72905m), false);
CheckBool("totals.descOnly", GdCostingMapping.LooksLikeTotalsRow("Total", 0m), false);

// A mapping with no GD number column cannot drive an import.
{
    checks++;
    try
    {
        GdCostingMapping.Parse("{\"columns\":{\"description\":3,\"quantity\":4}}");
        failures.Add("parse.noGd: expected a rejection, got none");
    }
    catch (InvalidOperationException) { /* expected */ }
}

// Valid JSON round-trips.
{
    var m = GdCostingMapping.Parse(
        "{\"headerRow\":1,\"firstDataRow\":3,\"columns\":{\"gdNumber\":1,\"gdDate\":2," +
        "\"description\":3,\"quantity\":4,\"unit\":5,\"hsCode\":6,\"assessedValue\":7," +
        "\"customsDuty\":8,\"acd\":9,\"regulatoryDuty\":10,\"salesTaxRate\":12," +
        "\"astRate\":14,\"others\":16,\"incomeTaxRate\":19,\"addOnProfit\":22,\"sellingValue\":23}}");
    Check("parse.firstDataRow", m.FirstDataRow, 3m);
    Check("parse.sellingValue", m.Columns.SellingValue ?? 0, 23m);
}

// Resolve: THE SWAP (rule 2). The mapping's defaults have Description and
// Quantity genuinely crossed relative to what the heading row says, so a
// one-at-a-time apply (move the first field, find the second one's target
// column already occupied, decline) cannot produce the right answer for
// both. Only resolve-all-first-then-apply gets both fields to move.
{
    var wb = new FakeWorkbook();
    wb.Set(0, 1, 3, "Quantity");
    wb.Set(0, 1, 4, "Description");
    var mapping = new GdCostingMapping
    {
        HeaderRow = 1,
        Columns = new GdCostingMapping.GdCostingColumns { Description = 3, Quantity = 4 },
        HeaderAliases = new Dictionary<string, List<string>>
        {
            ["description"] = new List<string> { "Description" },
            ["quantity"] = new List<string> { "Quantity" },
        },
    };
    var notes = new List<string>();
    var resolved = mapping.Resolve(wb, 0, notes);
    Check("resolve.swap.description", resolved.Description, 4);
    Check("resolve.swap.quantity", resolved.Quantity, 3);
    CheckBool("resolve.swap.notes", notes.Count >= 2, true);
}

// Resolve: MANY HITS (rule 3). The same heading text sits on two columns, so
// the mapped number is left alone and a note explains why.
{
    var wb = new FakeWorkbook();
    wb.Set(0, 1, 10, "Rate");
    wb.Set(0, 1, 11, "Rate");
    var mapping = new GdCostingMapping
    {
        HeaderRow = 1,
        Columns = new GdCostingMapping.GdCostingColumns { Unit = 5 },
        HeaderAliases = new Dictionary<string, List<string>> { ["unit"] = new List<string> { "Rate" } },
    };
    var notes = new List<string>();
    var resolved = mapping.Resolve(wb, 0, notes);
    Check("resolve.manyHits.unchanged", resolved.Unit ?? 0, 5);
    CheckBool("resolve.manyHits.notes", notes.Count >= 1, true);
}

// Resolve: COLLISION (rule 4). Two different fields' aliases both resolve to
// the one column "Misc" names, so the aliases are wrong, not the sheet --
// both are dropped and each keeps its own mapped number.
{
    var wb = new FakeWorkbook();
    wb.Set(0, 1, 20, "Misc");
    var mapping = new GdCostingMapping
    {
        HeaderRow = 1,
        Columns = new GdCostingMapping.GdCostingColumns { Acd = 8, Others = 9 },
        HeaderAliases = new Dictionary<string, List<string>>
        {
            ["acd"] = new List<string> { "Misc" },
            ["others"] = new List<string> { "Misc" },
        },
    };
    var notes = new List<string>();
    var resolved = mapping.Resolve(wb, 0, notes);
    Check("resolve.collision.acd", resolved.Acd ?? 0, 8);
    Check("resolve.collision.others", resolved.Others ?? 0, 9);
    CheckBool("resolve.collision.notes", notes.Count >= 1, true);
}

// Resolve: ZERO HITS. An alias matching no heading leaves the mapped number
// alone. Unlike the many-hits case, this path adds no note, so none is
// asserted here.
{
    var wb = new FakeWorkbook();
    var mapping = new GdCostingMapping
    {
        HeaderRow = 1,
        Columns = new GdCostingMapping.GdCostingColumns { HsCode = 6 },
        HeaderAliases = new Dictionary<string, List<string>> { ["hsCode"] = new List<string> { "NoSuchHeading" } },
    };
    var notes = new List<string>();
    var resolved = mapping.Resolve(wb, 0, notes);
    Check("resolve.zeroHits.unchanged", resolved.HsCode, 6);
}

// Optional: run a REAL client workbook through the shipped layout.
//   dotnet run -c Release -- --file "C:\path\Alpha Trader Costing.xlsx" --expect-lines 26 --expect-cost 18816870 --expect-selling 21940496.99
// The workbooks are client data and are never committed. Without --file the
// harness runs its synthetic cases only, which is what CI does.
var fileArg = Array.IndexOf(args, "--file");
if (fileArg >= 0 && fileArg + 1 < args.Length)
{
    var path = args[fileArg + 1];
    decimal Expect(string flag)
    {
        var i = Array.IndexOf(args, flag);
        return i >= 0 && i + 1 < args.Length ? decimal.Parse(args[i + 1]) : -1m;
    }

    using var stream = File.OpenRead(path);
    using var wb = WorkbookReaderFactory.Open(stream, Path.GetExtension(path));
    var mapping = GdCostingMapping.Parse(GdCostingLayout.MappingJson);
    var result = GdCostingSheetReader.Read(wb, 0, mapping);

    Console.WriteLine($"  {Path.GetFileName(path)}: {result.Rows.Count} lines, {result.Warnings.Count} warnings");
    foreach (var w in result.Warnings.Take(10)) Console.WriteLine("    " + w);

    var expLines = Expect("--expect-lines");
    if (expLines >= 0) Check("file.lines", result.Rows.Count, expLines);

    var expCost = Expect("--expect-cost");
    if (expCost >= 0) Check("file.cost", result.Rows.Sum(r => r.Computed.Cost), expCost, 1m);

    var expSelling = Expect("--expect-selling");
    if (expSelling >= 0)
        Check("file.selling", result.Rows.Sum(r => r.SheetSellingValue ?? r.Computed.SellingValue), expSelling, 1m);
}

Console.WriteLine($"{checks} checks, {failures.Count} failed");
foreach (var f in failures) Console.WriteLine("  FAIL " + f);
if (failures.Count > 0) return 1;
Console.WriteLine("GD COSTING HARNESS PASSED");
return 0;
