using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers;

/// <summary>
/// FBR refuses an invoice that lists the same item twice. Two items that agree
/// on everything FBR identifies an item by — HS code, product description,
/// sale type, unit, rate and SRO — and differ only in quantity and value come
/// back on the second one as "DUPLICATE INVOICE EXISTS", which reads like a
/// duplicate BILL number and is not one (Hakimi INV-3973, 2026-10-20: two
/// filing rows both "Office Stationary", HS 8470.1000).
///
/// One rule, used in two places so they cannot disagree: refusing filing rows
/// that collide when the consultant saves them, and checking the payload just
/// before it would be sent to FBR (which also covers grouped bills).
/// </summary>
public static class FbrDuplicateItems
{
    public const string FbrError = "DUPLICATE INVOICE EXISTS";

    /// <summary>One item as FBR sees it. <paramref name="RowNo"/> is 1-based, as
    /// the operator numbers rows. Pass the description that is actually sent —
    /// empty when the company omits product descriptions.</summary>
    public readonly record struct Item(int RowNo, string? HsCode, string? Description, string? SaleType,
        string? Uom, string? SroScheduleNo, string? SroItemSerialNo, string? Rate = null);

    /// <summary>The first set of colliding rows, as an instruction the operator
    /// can act on; null when every item is distinct. <paramref name="canMerge"/> is false for a company
    /// that files every bill line as its own row; the advice then points at the bill description.</summary>
    public static string? Message(IEnumerable<Item> items, bool canMerge = true)
    {
        var clash = items
            .GroupBy(i => (N(i.HsCode), N(i.Description), N(i.SaleType), N(i.Uom), N(i.SroScheduleNo), N(i.SroItemSerialNo), N(i.Rate)))
            .FirstOrDefault(g => g.Count() > 1);
        if (clash == null) return null;
        var first = clash.First();
        var rows = clash.Select(i => i.RowNo).ToList();
        var label = string.IsNullOrWhiteSpace(first.Description)
            ? $"HS {first.HsCode?.Trim()}"
            : $"HS {first.HsCode?.Trim()}, {first.Description!.Trim()}";
        var list = rows.Count == 2 ? $"{rows[0]} and {rows[1]}"
            : $"{string.Join(", ", rows.Take(rows.Count - 1))} and {rows[^1]}";
        return $"Rows {list} are the same FBR item ({label}). FBR rejects a repeated item as "
             + $"\"{FbrError}\". " + (canMerge
                 ? "Merge them into one row with the quantities and amounts added together, or give each a different classification."
                 : "Give those bill lines different descriptions on the bill, or give each a different classification.");
    }

    /// <summary>FBR's item error text, with the explanation added when it is the
    /// repeated-item rejection.</summary>
    public static string Explain(string? fbrError) =>
        fbrError != null && fbrError.Contains(FbrError, StringComparison.OrdinalIgnoreCase)
            ? $"{fbrError} (this item repeats another row's HS code and description; merge those rows into one)"
            : fbrError ?? "";

    private static string N(string? s) => Regex.Replace((s ?? "").Trim(), @"\s+", " ").ToUpperInvariant();
}
