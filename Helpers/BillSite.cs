using MyApp.Api.Models;

namespace MyApp.Api.Helpers;

/// <summary>
/// The site a bill shows. A challan-linked bill takes the sites of its
/// challans; a standalone bill has no challan, so it keeps its own
/// (<see cref="Invoice.Site"/>, chosen on the bill form). One rule for the bill
/// screen and both prints, so they cannot disagree.
/// </summary>
public static class BillSite
{
    public const int MaxLength = 200;

    public static string Of(Invoice inv, string separator)
    {
        var fromChallans = inv.DeliveryChallans
            .OrderBy(c => c.ChallanNumber).ThenBy(c => c.Id)
            .Select(c => c.Site?.Trim())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (fromChallans.Count > 0) return string.Join(separator, fromChallans);
        return inv.Site?.Trim() ?? "";
    }

    /// <summary>A typed site, trimmed; blank is none.</summary>
    public static string? Clean(string? site)
    {
        var s = site?.Trim();
        if (string.IsNullOrEmpty(s)) return null;
        return s.Length <= MaxLength ? s : s[..MaxLength];
    }
}
