using MyApp.Api.DTOs;
void Check(bool passed, string message) { if (!passed) throw new Exception(message); }
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
