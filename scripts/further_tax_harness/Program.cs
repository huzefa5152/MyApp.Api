using MyApp.Api.Helpers;

var checks = 0;
void Check(bool condition, string label)
{
    if (!condition) throw new Exception(label);
    checks++;
}
Check(FurtherTaxCalculator.Resolve(4m, 1000m) == 40m, "4% on net supply");
Check(FurtherTaxCalculator.GrandTotal(1000m, 180m, 40m) == 1220m, "Gross includes further tax");
Check(FurtherTaxCalculator.Resolve(null, 1000m) == 0m, "Saved exemption stays zero");
Check(FurtherTaxCalculator.Allocate(0m, Array.Empty<decimal>()).Length == 0, "Empty zero-tax payload");
foreach (var amount in new[] { 0m, .01m, .02m, 40m, 123.45m })
foreach (var values in new[] {
    new decimal[] { 1m, 1m, 1m },
    new decimal[] { 0m, 1m, 0m },
    new decimal[] { 123.45m, 987.65m, 31.01m },
    new decimal[] { 1000m },
    new decimal[] { 1000m, 0m, 0m } })
{
    var rows = FurtherTaxCalculator.Allocate(amount, values);
    Check(rows.Sum() == amount, "Allocated total equals saved invoice tax");
    Check(rows.All(v => v >= 0m && decimal.Round(v, 2) == v), "Nonnegative money precision");
    Check(rows.Where((v, i) => values[i] == 0m).All(v => v == 0m), "No tax on zero-value rows");
}
var seed = new Random(42);
for (var i = 0; i < 1000; i++)
{
    var values = Enumerable.Range(0, seed.Next(1, 40))
        .Select(_ => seed.Next(1, 1000000) / 100m).ToArray();
    var tax = FurtherTaxCalculator.Resolve(4m, values.Sum());
    Check(FurtherTaxCalculator.Allocate(tax, values).Sum() == tax, "Grouping/rounding preserves tax");
}
Console.WriteLine($"{checks} checks passed");
