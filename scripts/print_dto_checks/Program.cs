using System.Text.Json;
using MyApp.Api.DTOs;

void Check(bool passed, string message)
{
    if (!passed) throw new Exception(message);
}

var original = new PrintBillItemDto { Quantity = 2m, UnitPrice = 125.25m, LineTotal = 250.50m, GSTRate = 18m };
Check(original.ValueExclTax == 250.50m && original.GSTAmount == 45.09m && original.TotalInclTax == 295.59m,
    "Standard-tax bill line must expose unrounded source values and two-decimal tax.");
var exempt = new PrintBillItemDto { Quantity = 3m, UnitPrice = 33.333333333333m, LineTotal = 100m, GSTRate = 0m };
Check(exempt.GSTAmount == 0 && exempt.TotalInclTax == 100m && exempt.ValueExclTax == 100m,
    "Use stored line value, not recomposed rounded unit price, for an exempt line.");
var fractional = new PrintBillItemDto { Quantity = 1m, UnitPrice = 12.34m, LineTotal = 12.34m, GSTRate = 17.5m };
Check(fractional.GSTAmount == 2.16m && fractional.TotalInclTax == 14.50m, "Fractional GST rounding.");
var bill = new PrintBillDto { Items = [original, exempt], ClientPhone = "sample-phone" };
using var json = JsonDocument.Parse(JsonSerializer.Serialize(bill, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
var root = json.RootElement;
Check(root.GetProperty("printTemplateType").GetString() == "Bill", "Bill renderer discriminator.");
Check(root.GetProperty("clientPhone").GetString() == "sample-phone", "Buyer phone merge field.");
Check(root.GetProperty("fbrIRN").ValueKind == JsonValueKind.Null && root.GetProperty("fbrLogoUrl").ValueKind == JsonValueKind.Null,
    "Unsubmitted bill assets default to empty.");
var row = root.GetProperty("items")[0];
Check(row.GetProperty("gstRate").GetDecimal() == 18m && row.GetProperty("gstAmount").GetDecimal() == 45.09m
    && row.GetProperty("totalInclTax").GetDecimal() == 295.59m && row.GetProperty("unitPrice").GetDecimal() == 125.25m,
    "Actual serialized keys and values used by the eight-column template.");
Console.WriteLine("PASS: print DTO tax columns, fractional/exempt tax, exact line values, original rates, JSON merge fields, empty FBR defaults.");

// Reclassification merges two original types into one invoice type. Match
// original quantities through source lines, never by parallel loop indexes.
var sources = new[] {
    new MyApp.Api.Helpers.PrintItemSource(2m, 20m, "Bill A", "Invoice X", "PCS", "KG", 100m),
    new MyApp.Api.Helpers.PrintItemSource(3m, 30m, "Bill B", "Invoice X", "PCS", "KG", 200m),
    new MyApp.Api.Helpers.PrintItemSource(4m, 40m, "Bill A", "Invoice Y", "PCS", "KG", 300m)
};
var invoiceGroups = sources.GroupBy(x => x.InvoiceType)
    .Select(g => MyApp.Api.Helpers.PrintItemChoices.Apply(new PrintTaxItemDto { Quantity = 999m }, g, 18m)).ToList();
Check(invoiceGroups.Count == 2 && invoiceGroups[0].BillQuantity == 5m && invoiceGroups[0].InvoiceQuantity == 50m,
    "Merged invoice group must sum the corresponding original source quantities.");
Check(invoiceGroups[0].BillItemTypeName == "Bill A, Bill B" && invoiceGroups[0].InvoiceItemTypeName == "Invoice X",
    "Merged descriptions must preserve all distinct original types without HS codes.");
Check(invoiceGroups[0].InvoiceValueExclTax == 300m && invoiceGroups[0].InvoiceUnitPrice == 6m
    && invoiceGroups[0].InvoiceGstAmount == 54m && invoiceGroups[0].Quantity == 999m,
    "Display choices must preserve existing fields and use invoice financial values.");
var billGroups = sources.GroupBy(x => x.BillType)
    .Select(g => MyApp.Api.Helpers.PrintItemChoices.Apply(new PrintTaxItemDto(), g, 18m)).ToList();
Check(billGroups[0].BillQuantity == 6m && billGroups[0].InvoiceQuantity == 60m
    && billGroups[0].InvoiceItemTypeName == "Invoice X, Invoice Y" && billGroups[0].InvoiceValueExclTax == 400m,
    "A Bill group split across invoice types must retain all corresponding values.");
Check(billGroups.Sum(x => x.InvoiceValueExclTax) == invoiceGroups.Sum(x => x.InvoiceValueExclTax),
    "Changing grouping must not duplicate or omit invoice line values.");
var zero = MyApp.Api.Helpers.PrintItemChoices.Apply(new PrintTaxItemDto(),
    [new(0m, 0m, null, null, null, null, 10.125m)], 0m);
Check(zero.InvoiceUnitPrice == 0m && zero.InvoiceGstAmount == 0m && zero.InvoiceTotalInclTax == 10.125m,
    "Zero quantity and exempt rows must retain stored values without division by zero.");
Console.WriteLine("PASS: original/adjusted print choices, merged and split classifications, grouping totals, unchanged legacy fields, zero/exempt rows.");
