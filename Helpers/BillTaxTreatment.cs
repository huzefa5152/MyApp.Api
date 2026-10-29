using MyApp.Api.Models;
namespace MyApp.Api.Helpers;

/// <summary>
/// The ONE rule for a bill's tax treatment (ported from Trader). FBR is the
/// default and what every existing bill holds. SRB and NoTax bills are
/// commercial sales outside FBR: never validated or submitted, kept out of
/// FBR's tax figures, but still sales -- stock, ledger, balances and sales
/// reports treat them like any other bill. Only a company with
/// <see cref="Company.AllowNonFbrBills"/> may create one.
/// </summary>
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
