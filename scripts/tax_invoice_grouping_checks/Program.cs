using System.Reflection;
using ClosedXML.Excel;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Implementations;

var checks = 0;
void Check(bool ok, string message) { checks++; if (!ok) throw new Exception(message); }
var validation = new List<System.ComponentModel.DataAnnotations.ValidationResult>();
var omitted = new TaxInvoiceGroupingDto();
var explicitIndividual = new TaxInvoiceGroupingDto { GroupTaxInvoiceByItemType = false };
Check(!System.ComponentModel.DataAnnotations.Validator.TryValidateObject(omitted, new System.ComponentModel.DataAnnotations.ValidationContext(omitted), validation, true), "An omitted layout choice must be rejected.");
Check(System.ComponentModel.DataAnnotations.Validator.TryValidateObject(explicitIndividual, new System.ComponentModel.DataAnnotations.ValidationContext(explicitIndividual), [], true), "Explicit individual is a valid choice.");
var invoice = new Invoice {
    Id = 1, CompanyId = 1, InvoiceNumber = 1, Date = new(2026, 1, 1),
    Company = new Company { Id = 1, Name = "Sample company" },
    Client = new Client { Id = 1, Name = "Sample buyer" },
    GSTRate = 18m, Subtotal = 800m, GSTAmount = 144m, GrandTotal = 944m,
    Items = new List<InvoiceItem> {
        new() { Id = 1, ItemTypeId = 1, ItemTypeName = "Sample item", Description = "First line", UOM = "PCS", HSCode = "1111.0000", Quantity = 2m, UnitPrice = 100m, LineTotal = 200m },
        new() { Id = 2, ItemTypeId = 1, ItemTypeName = "Sample item", Description = "Second line", UOM = "PCS", HSCode = "1111.0000", Quantity = 3m, UnitPrice = 200m, LineTotal = 600m }
    }
};
var repo = DispatchProxy.Create<IInvoiceRepository, InvoiceProxy>();
((InvoiceProxy)(object)repo).Invoice = invoice;
var service = new InvoiceService(repo, null!, null!, null!, null!, new ConfigurationBuilder().Build(), null!, null!, null!, null!, NullLogger<InvoiceService>.Instance);
Check(!invoice.GroupTaxInvoiceByItemType && !invoice.Company.DefaultGroupTaxInvoiceByItemType, "Existing documents and companies default to individual.");
var individual = (await service.GetPrintTaxInvoiceAsync(1))!;
Check(individual.Items.Count == 2 && individual.BillItems.Count == 2, "Individual output keeps each source line in both template loops.");
Check(individual.Items[0].Description == "First line" && individual.Items[1].Description == "Second line", "Individual output keeps descriptions.");
invoice.GroupTaxInvoiceByItemType = true;
var grouped = (await service.GetPrintTaxInvoiceAsync(1))!;
Check(grouped.Items.Count == 1 && grouped.BillItems.Count == 1, "Compatible items group in both template loops.");
Check(grouped.Items[0].Quantity == 5m && grouped.Items[0].ValueExclTax == 800m && grouped.Items[0].UnitPrice == 160m, "Grouped quantity and value sum; weighted price preserves value.");
Check(grouped.Items.Sum(i => i.GSTAmount) == 144m && grouped.Items.Sum(i => i.TotalInclTax) == 944m, "Grouped taxes and inclusive value agree.");
Check(grouped.Subtotal == individual.Subtotal && grouped.GSTAmount == individual.GSTAmount && grouped.GrandTotal == individual.GrandTotal, "Layout never changes header amounts.");
var excel = ExcelTemplateEngine.TaxInvoiceToDict(grouped);
Check(excel.ContainsKey("items") && excel.ContainsKey("billItems"), "Excel uses both common print loops.");
using (var workbook = new XLWorkbook()) {
    var sheet = workbook.AddWorksheet("Sales Tax Invoice");
    sheet.Cell("A1").Value = "{{#each items}}";
    sheet.Cell("A2").Value = "{{this.quantity}}";
    sheet.Cell("B2").Value = "{{this.unitPrice}}";
    sheet.Cell("C2").Value = "{{this.valueExclTax}}";
    sheet.Cell("A3").Value = "{{/each}}";
    ExcelTemplateEngine.Process(workbook, excel);
    Check(sheet.CellsUsed().Any(c => c.TryGetValue<decimal>(out var v) && v == 160m), "Excel renders weighted unit price.");
    Check(sheet.CellsUsed().Any(c => c.TryGetValue<decimal>(out var v) && v == 800m), "Excel renders exact grouped value.");
    using var stream = new MemoryStream(); workbook.SaveAs(stream); stream.Position = 0;
    using var reopened = new XLWorkbook(stream);
    Check(reopened.Worksheet(1).CellsUsed().Any(c => c.TryGetValue<decimal>(out var v) && v == 5m), "Saved Excel retains grouped quantity.");
}
invoice.Items.Last().UOM = "KG";
Check((await service.GetPrintTaxInvoiceAsync(1))!.Items.Count == 2, "Different units stay separate.");
invoice.Items.Last().UOM = "PCS";
invoice.Items.Last().HSCode = "2222.0000";
Check((await service.GetPrintTaxInvoiceAsync(1))!.Items.Count == 2, "Different HS codes stay separate.");
invoice.Items.Last().HSCode = "1111.0000";
invoice.Items.Last().RateId = 2;
Check((await service.GetPrintTaxInvoiceAsync(1))!.Items.Count == 2, "Different rate classifications stay separate.");
invoice.Items.Last().RateId = null;
invoice.Items.Last().ItemTypeId = 2;
Check((await service.GetPrintTaxInvoiceAsync(1))!.Items.Count == 2, "Same label with different catalog identity stays separate.");
invoice.Items.Last().ItemTypeId = 1;
invoice.Items.First().Adjustment = new InvoiceItemAdjustment { AdjustedQuantity = 4m, AdjustedLineTotal = 200m };
grouped = (await service.GetPrintTaxInvoiceAsync(1))!;
Check(grouped.Items[0].Quantity == 7m && grouped.BillItems[0].Quantity == 5m, "Tax output respects overlays while bill-choice quantities remain original.");
Check(grouped.Items[0].ValueExclTax == 800m, "Overlay grouping preserves exact line values.");
invoice.GroupTaxInvoiceByItemType = false;
individual = (await service.GetPrintTaxInvoiceAsync(1))!;
Check(individual.Items.Count == 2 && individual.Items[0].Quantity == 4m && individual.BillItems[0].Quantity == 2m, "Individual tax output also respects overlays.");
Check(invoice.Items.Count == 2 && invoice.Items.First().Quantity == 2m && invoice.Items.Last().Quantity == 3m, "Projection never mutates source lines.");
invoice.Items.First().ItemTypeName = "";
invoice.Items.Last().ItemTypeName = "";
invoice.GroupTaxInvoiceByItemType = true;
Check((await service.GetPrintTaxInvoiceAsync(1))!.Items.Count == 2, "Unclassified lines remain separate.");
invoice.Items.First().Adjustment = null;
foreach (var line in invoice.Items) { line.LineTotal = 0.03m; line.Quantity = 1m; line.ItemTypeName = "Sample item"; }
invoice.Subtotal = 0.06m; invoice.GSTAmount = 0.01m; invoice.GrandTotal = 0.07m;
grouped = (await service.GetPrintTaxInvoiceAsync(1))!;
invoice.GroupTaxInvoiceByItemType = false;
individual = (await service.GetPrintTaxInvoiceAsync(1))!;
Check(grouped.Items.Sum(r => r.GSTAmount) == individual.Items.Sum(r => r.GSTAmount)
    && individual.Items.Sum(r => r.GSTAmount) == invoice.GSTAmount, "Penny tax rounding preserves totals in either layout.");
Console.WriteLine($"PASS: {checks} tax-invoice grouping checks.");

public class InvoiceProxy : DispatchProxy {
    public Invoice Invoice { get; set; } = null!;
    protected override object? Invoke(MethodInfo? method, object?[]? args) =>
        method?.Name == "GetByIdAsync" ? Task.FromResult<Invoice?>(Invoice) : throw new NotSupportedException(method?.Name);
}
