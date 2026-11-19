// What FBR is sent as further tax: the bill's own rate, and nothing else.
// A bill saved at 0% for an unregistered buyer used to be filed at 4%.
//   cd scripts/fbr_line_tax_harness && dotnet run -c Release
using MyApp.Api.Helpers;
using MyApp.Api.Models;

int failed = 0, run = 0;
void Check(string name, decimal got, decimal want)
{
    run++;
    if (got == want) { Console.WriteLine($"  ok    {name}"); return; }
    failed++;
    Console.WriteLine($"  FAIL  {name}: expected {want}, got {got}");
}

const string Standard = "Goods at Standard Rate (default)";
InvoiceItem Line(string saleType = Standard) =>
    new() { LineTotal = 10000m, Quantity = 10m, SaleType = saleType };

decimal Filed(decimal? rate, string reg = "Unregistered", string? sn = "SN002", string saleType = Standard) =>
    FbrLineTax.Compute(Line(saleType), 18m, reg, sn, rate, null, followDocumentFurtherTax: true).FurtherTax;

Console.WriteLine("-- FBR payload follows the bill --");
Check("unregistered, bill at 0% files 0", Filed(0m), 0m);
Check("unregistered, bill with no rate files 0", Filed(null), 0m);
Check("unregistered, bill at 4% files 4%", Filed(4m), 400m);
Check("unregistered, bill at 3% files 3%", Filed(3m), 300m);
Check("unregistered, no scenario, bill at 0% files 0", Filed(0m, sn: null), 0m);
Check("registered, bill at 0% files 0", Filed(0m, reg: "Registered", sn: "SN001"), 0m);
Check("registered, bill at 4% files 4%", Filed(4m, reg: "Registered", sn: "SN001"), 400m);
Check("end-consumer retail, bill at 0% files 0", Filed(null, sn: "SN026"), 0m);
Check("3rd schedule, bill at 2.5% files 2.5%", Filed(2.5m, saleType: "3rd Schedule Goods"), 250m);
Check("sales tax is untouched",
    FbrLineTax.Compute(Line(), 18m, "Unregistered", "SN002", 0m, null, followDocumentFurtherTax: true).SalesTax, 1800m);

Console.WriteLine("-- a filing from before the fix is restated by the old rule --");
Check("unregistered standard rate, no rate on the bill, was filed at 4%",
    FbrLineTax.Compute(Line(), 18m, "Unregistered", null).FurtherTax, 400m);
Check("registered, no rate on the bill, was filed at none",
    FbrLineTax.Compute(Line(), 18m, "Registered", null).FurtherTax, 0m);
Check("a rate on the bill was filed even then (3%)",
    FbrLineTax.Compute(Line(), 18m, "Unregistered", null, 3m).FurtherTax, 300m);

Console.WriteLine("-- which rule a report uses --");
void Flag(string name, bool got, bool want) => Check(name, got ? 1m : 0m, want ? 1m : 0m);
Flag("filed before the fix: old rule",
    FbrLineTax.FiledUnderStatutoryRule(FbrLineTax.DocumentRateFiledFrom.AddSeconds(-1)), true);
Flag("filed since: follows the bill",
    FbrLineTax.FiledUnderStatutoryRule(FbrLineTax.DocumentRateFiledFrom), false);
Flag("not filed yet: follows the bill", FbrLineTax.FiledUnderStatutoryRule(null), false);

Console.WriteLine("-- the rate a new bill starts on --");
void Rate(string name, decimal? got, decimal? want) => Check(name, got ?? -1m, want ?? -1m);
Rate("unregistered starts on 4", FurtherTaxCalculator.DefaultRate("Unregistered"), 4m);
Rate("CNIC buyer starts on 4", FurtherTaxCalculator.DefaultRate("CNIC"), 4m);
Rate("no registration type starts on 4, as the form does", FurtherTaxCalculator.DefaultRate(null), 4m);
Rate("registered starts on none", FurtherTaxCalculator.DefaultRate("Registered"), null);
Rate("registered, any case or spacing", FurtherTaxCalculator.DefaultRate(" registered "), null);

Console.WriteLine("-- the filed items add up to the bill --");
// Three lines of 33.33 at 4% round to 1.33 each (3.99); the bill says 4.00.
var settled = FurtherTaxCalculator.SettleToBill(4.00m, new[] { 1.33m, 1.33m, 1.33m });
Check("a paisa of rounding is settled", settled.Sum(), 4.00m);
Check("onto one item only", settled.Count(x => x != 1.33m), 1m);
Check("already equal is left alone", FurtherTaxCalculator.SettleToBill(400m, new[] { 400m })[0], 400m);
Check("a zero bill keeps zero items", FurtherTaxCalculator.SettleToBill(0m, new[] { 0m, 0m }).Sum(), 0m);
Check("a real difference is not rounding and is not touched",
    FurtherTaxCalculator.SettleToBill(400m, new[] { 100m, 100m }).Sum(), 200m);
Check("nothing to settle on an empty filing", FurtherTaxCalculator.SettleToBill(5m, Array.Empty<decimal>()).Length, 0m);

Console.WriteLine(failed == 0 ? $"{run}/{run} FBR line tax checks passed" : $"{failed} of {run} FAILED");
return failed == 0 ? 0 : 1;
