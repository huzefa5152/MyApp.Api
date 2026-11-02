using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

public static class FbrSetupRules
{
    public static bool IsReady(Company company, Client client)
    {
        // Company fields — the seller is fileable only once the dedicated
        // FBR seller registration number is set (the value filed at PRAL).
        // The display NTN is no longer the FBR identity.
        if (string.IsNullOrWhiteSpace(company.FbrSellerRegistrationNo)) return false;
        // STRN is NOT an FBR digital-invoicing field: the seller/buyer block
        // FBR validates is NTN/CNIC + name + province + address + registration
        // type. Requiring an STRN only stranded real, fileable challans in
        // "Setup Required", so it is no longer part of FBR-readiness.
        if (company.FbrProvinceCode == null) return false;
        if (string.IsNullOrWhiteSpace(company.FbrBusinessActivity)) return false;
        if (string.IsNullOrWhiteSpace(company.FbrSector)) return false;
        if (string.IsNullOrWhiteSpace(company.FbrToken)) return false;
        if (string.IsNullOrWhiteSpace(company.FbrEnvironment)) return false;

        // Client fields -- the same buyer rule FbrService's pre-flight applies:
        // a registered buyer files under its NTN or CNIC; an unregistered one
        // (Unregistered, or CNIC-only) needs neither. Demanding an NTN from
        // every buyer, and a CNIC from an unregistered one, held fileable bills
        // in "Setup" and their challans in "Setup Required".
        if (string.IsNullOrWhiteSpace(client.RegistrationType)) return false;
        if (client.FbrProvinceCode == null) return false;
        var unregistered = client.RegistrationType is "Unregistered" or "CNIC";
        if (!unregistered && string.IsNullOrWhiteSpace(client.NTN) && string.IsNullOrWhiteSpace(client.CNIC))
            return false;

        return true;
    }
}
