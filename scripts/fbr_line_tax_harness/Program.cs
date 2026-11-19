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

Console.WriteLine("-- callers with no document rate keep the statutory rule --");
Check("unregistered standard rate derives 4%",
    FbrLineTax.Compute(Line(), 18m, "Unregistered", null).FurtherTax, 400m);
Check("registered derives none",
    FbrLineTax.Compute(Line(), 18m, "Registered", null).FurtherTax, 0m);

Console.WriteLine(failed == 0 ? $"{run}/{run} FBR line tax checks passed" : $"{failed} of {run} FAILED");
return failed == 0 ? 0 : 1;
