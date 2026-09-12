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

Console.WriteLine($"{checks} checks, {failures.Count} failed");
foreach (var f in failures) Console.WriteLine("  FAIL " + f);
if (failures.Count > 0) return 1;
Console.WriteLine("GD COSTING HARNESS PASSED");
return 0;
