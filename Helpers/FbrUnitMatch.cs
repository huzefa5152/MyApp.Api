using MyApp.Api.DTOs;

namespace MyApp.Api.Helpers;

/// <summary>
/// Pairs a unit name with FBR's unit id for one HS code. FBR receives the unit the ID names, so a name and an
/// id that disagree file something other than what the operator saw: "Packs" stored with KG's id went to FBR as
/// KG (Hakimi bill 3985, 2026-10-26). The name is what the operator chose and saw, so it wins when FBR lists it.
/// </summary>
public static class FbrUnitMatch
{
    /// <summary>
    /// The FBR unit that <paramref name="uom"/> and <paramref name="fbrUomId"/> describe: the unit FBR lists under
    /// that name, else the one under that id (a local alias such as "Nos" for "Numbers, pieces, units"). Null when
    /// neither is listed, or when both are blank and nothing was chosen.
    /// </summary>
    public static FbrUOMDto? Resolve(IReadOnlyList<FbrUOMDto> units, string? uom, int? fbrUomId)
    {
        if (!string.IsNullOrWhiteSpace(uom))
        {
            var name = Normalize(uom);
            var named = units.FirstOrDefault(u => Normalize(u.Description) == name);
            if (named != null) return named;
        }
        return fbrUomId is int id ? units.FirstOrDefault(u => u.UOM_ID == id) : null;
    }

    private static string Normalize(string s) => new string(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();
}
