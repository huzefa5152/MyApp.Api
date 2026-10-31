using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers;

/// <summary>
/// One-line item name for an FBR HS code. FBR's descriptions read "CHAPTER. - HEADING (detail) - - leaf",
/// which is a paragraph as an item name; operators want "Padlocks and locks". Takes the most specific
/// segment that says something ("OTHER" says nothing) and keeps its first clause. A leaf that only
/// qualifies ("Dyed", "Parts", "Of cotton") is prefixed with its heading: "Electric accumulators – parts".
/// Tuned against the full 7,806-code FBR list; the operator can still edit the name.
/// </summary>
public static class HsShortName
{
    private static readonly Regex Segment = new(@"\s-\s", RegexOptions.Compiled);
    private static readonly Regex Empty = new(@"^(other|others|nes|n\.e\.s\.?|other than .*)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Qualifier = new(@"^((of|in|for|with|not|parts?|components?|accessories|having|containing|measuring|weighing|whether|put up|n\.e\.s)\b|other,)",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex Reference = new(@"\s\S*\d\S*", RegexOptions.Compiled); // "of heading 8458.1900", "600 mm"
    private static readonly HashSet<string> Dangling = new(StringComparer.OrdinalIgnoreCase) {
        "of", "or", "for", "and", "on", "other", "than", "the", "a", "an", "with", "by", "in", "to", "not", "exceeding",
        "whether", "nor", "its", "their", "including", "heading", "subheading", "sub", "chapter", "but", "from", "at", "as",
        "such", "which", "used", "obtained", "simply", "principally", "having", "containing", "excluding", "except", "etc",
        "those", "that", "said" };

    public static string From(string? description)
    {
        var parts = Segment.Split(description ?? "").Select(s => s.TrimStart(' ', '-').TrimEnd(' ', '.', ';', ':', '-').Trim()).ToList();
        var chapter = parts[0];
        var meaningful = parts.Skip(1).Where(p => p.Length > 0 && !Empty.IsMatch(p)).ToList();
        var leaf = meaningful.Count > 0 ? Clause(meaningful[^1], 48) : "";
        if (Dangling.Contains(leaf)) leaf = "";
        var head = Clause(meaningful.Count > 1 ? meaningful[0] : chapter, 30);
        string text;
        if (leaf.Length == 0)
            text = Clause(meaningful.Count > 1 ? meaningful[0] : chapter, 48);
        else if ((Qualifier.IsMatch(leaf) || !leaf.Contains(' ')) && head.Length > 0 && !head.Equals(leaf, StringComparison.OrdinalIgnoreCase))
        {
            text = $"{head} – {leaf}";
            if (text.Length > 60) text = $"{Clause(head, 24)} – {Clause(leaf, 30)}";
        }
        else text = leaf;
        text = text.ToLowerInvariant();
        return text.Length == 0 ? "" : char.ToUpperInvariant(text[0]) + text[1..];
    }

    // First clause of one segment, without references, at most max characters, never ending mid-word or on "of".
    private static string Clause(string s, int max)
    {
        s = Regex.Replace(s, @"\s+", " ");
        s = Regex.Replace(s, @"^\([^)]*\)\s*", "");
        s = s.Split('(', ';', ':')[0].Trim();
        s = Reference.Split(s)[0].Trim();
        if (s.Length > max)
        {
            var cut = s[..(max + 1)];
            var comma = cut.LastIndexOf(',');
            s = comma > 15 ? cut[..comma] : cut[..Math.Max(cut.LastIndexOf(' '), 1)];
        }
        var words = s.TrimEnd(' ', ',', '.', '/', '-').Split(' ').ToList();
        while (words.Count > 1 && Dangling.Contains(words[^1].Trim(','))) words.RemoveAt(words.Count - 1);
        return string.Join(' ', words).TrimEnd(' ', ',', '.', '/', '-');
    }
}
