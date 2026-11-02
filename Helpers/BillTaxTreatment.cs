using MyApp.Api.Models;
namespace MyApp.Api.Helpers;
public static class BillTaxTreatment
{
    public static bool IsOutsideFbr(string? value) => value is "SRB" or "NoTax";
    public static string Label(string? value) => value == "SRB" ? "SRB sales tax" : value == "NoTax" ? "No tax" : "GST";
    public static string Validate(string? value, Company company, decimal rate, string? existing = null)
    {
        var treatment = value ?? existing ?? "FBR";
        if (treatment is not ("FBR" or "SRB" or "NoTax"))
            throw new InvalidOperationException("Choose a valid tax treatment.");
        if (IsOutsideFbr(treatment) && !company.AllowNonFbrBills && treatment != existing)
            throw new InvalidOperationException("Non-FBR billing is not enabled for this company.");
        if (rate < 0 || rate > 100 || (treatment == "NoTax" && rate != 0))
            throw new InvalidOperationException("Enter a tax rate between 0 and 100; no-tax bills must use zero.");
        return treatment;
    }
}
