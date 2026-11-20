// PrintDtos.cs (linked for ExcelTemplateEngine) reads BillTaxTreatment.Label.
// The real helper validates against the Company model, which this harness does
// not compile, and no stock export prints a tax label.
namespace MyApp.Api.Helpers;

public static class BillTaxTreatment
{
    public static string Label(string? treatment) => treatment ?? "";
}
