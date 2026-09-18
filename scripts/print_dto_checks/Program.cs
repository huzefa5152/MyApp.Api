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
