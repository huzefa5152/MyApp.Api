using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// What a WeBOC GD number says about itself (2026-10-05). A Pakistan Customs
    /// goods declaration is numbered COLLECTORATE-TYPE-SERIAL, e.g.
    /// <c>KAPE-HC-12274</c>: the collectorate that assessed it and the kind of
    /// declaration. Read from the number on every request rather than stored, so
    /// nothing has to be typed twice and an old GD answers the same way as a new
    /// one. Only codes whose meaning is certain are named; any other code is shown
    /// as itself, never guessed at.
    /// </summary>
    public static class GdNumberParts
    {
        private static readonly Regex Shape = new(@"^\s*([A-Za-z]{2,6})\s*-\s*([A-Za-z]{2,3})\s*-\s*(\d+)\s*$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant);

        private static readonly Dictionary<string, string> Collectorates = new(StringComparer.OrdinalIgnoreCase)
        {
            ["KAPE"] = "Karachi Appraisement (East)",
            ["KAPW"] = "Karachi Appraisement (West)",
            ["KPPI"] = "Port Muhammad bin Qasim (Imports)",
        };

        private static readonly Dictionary<string, string> Types = new(StringComparer.OrdinalIgnoreCase)
        {
            ["HC"] = "Home consumption",
        };

        public sealed record Parts(string? Collectorate, string? CollectorateName, string? Type, string? TypeName);

        public static Parts Parse(string? gdNumber)
        {
            var m = Shape.Match(gdNumber ?? "");
            if (!m.Success) return new Parts(null, null, null, null);
            var c = m.Groups[1].Value.ToUpperInvariant();
            var t = m.Groups[2].Value.ToUpperInvariant();
            return new Parts(c, Collectorates.GetValueOrDefault(c), t, Types.GetValueOrDefault(t));
        }
    }
}
