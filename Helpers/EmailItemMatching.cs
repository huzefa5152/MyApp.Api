using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers;

public static class EmailItemMatching
{
    public static string Normalize(string? value) => Regex.Replace((value ?? "").Trim().ToLowerInvariant(), @"\s+", " ", RegexOptions.None, TimeSpan.FromSeconds(1));
    public static int Score(string requested, string candidate)
    {
        var a = Normalize(requested); var b = Normalize(candidate);
        if (a.Length == 0 || b.Length == 0) return 0;
        if (a == b) return 100;
        // Different model numbers, dimensions or ratings must never be blurred by fuzzy text matching.
        string[] Numbers(string s) => Regex.Matches(s, @"\d+(?:\.\d+)?", RegexOptions.None, TimeSpan.FromSeconds(1))
            .Select(m => m.Value).Order().ToArray();
        if (!Numbers(a).SequenceEqual(Numbers(b))) return 0;
        HashSet<string> Tokens(string s) => Regex.Matches(s, @"[\p{L}\p{N}]+", RegexOptions.None, TimeSpan.FromSeconds(1)).Select(m => m.Value).ToHashSet();
        var left = Tokens(a); var right = Tokens(b);
        return (int)Math.Round(100d * left.Intersect(right).Count() / Math.Max(1, left.Union(right).Count()));
    }
}
