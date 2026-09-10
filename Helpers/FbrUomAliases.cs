namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The unit an operator TYPES against the unit FBR NAMES.
    ///
    /// FBR's UOM catalog says "Numbers, pieces, units", "KG", "Meter"; a real
    /// tenant's whole catalog said "Pcs", "Kg" and "KG" with no FBR UOM id
    /// (2026-09-10). Exact matching therefore failed the HS/UoM pre-flight on
    /// every bill. Worse, FBR's catalog ALSO lists "Pcs", "NO" and "Kilogram"
    /// as units in their own right, so an exact match against the company-wide
    /// list happily sent "Pcs" -- which HS 8481.1000 refuses with [0099],
    /// because that heading accepts only "Numbers, pieces, units". The unit
    /// on a filing must therefore be resolved against the HS CODE's own valid
    /// list, and a local spelling recognised as any member of its family.
    ///
    /// This is the ONE place a local spelling is recognised as an FBR unit;
    /// both the pre-flight (<c>TaxMappingEngine</c>) and the payload builder
    /// (<c>FbrService.ResolveUomDesc</c>) go through <see cref="SameUnit"/>,
    /// so what is checked is what is sent. A family is only ever matched
    /// against a description FBR actually returned, never invented, so a wrong
    /// alias can produce a rejection but not a wrong unit on a filing.
    /// </summary>
    public static class FbrUomAliases
    {
        /// <summary>Letters and digits only, lower case: "Numbers, pieces, units" -> "numberspiecesunits".</summary>
        public static string Normalize(string? s)
            => string.IsNullOrWhiteSpace(s)
                ? ""
                : new string(s.Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

        /// <summary>Families of spellings that mean the same unit (normalised).</summary>
        private static readonly string[][] Families =
        {
            new[] { "numberspiecesunits", "pc", "pcs", "piece", "pieces", "no", "nos", "number", "numbers", "unit", "units", "each", "ea" },
            new[] { "kg", "kgs", "kilogram", "kilograms", "kilo", "kilos" },
            new[] { "mt", "metricton", "metrictons", "ton", "tons", "tonne", "tonnes" },
            new[] { "meter", "meters", "metre", "metres", "m", "mtr", "mtrs" },
            new[] { "liter", "liters", "litre", "litres", "ltr", "ltrs", "l" },
            new[] { "squaremetre", "squaremetres", "squaremeter", "squaremeters", "sqm", "sqmtr", "sqmtrs" },
            new[] { "squarefoot", "squarefeet", "sqft", "sft" },
            new[] { "dozen", "dozens", "doz", "dz" },
            new[] { "gram", "grams", "g", "gm", "gms" },
            new[] { "pair", "pairs", "pr", "prs" },
            new[] { "set", "sets" },
            new[] { "bag", "bags" },
            new[] { "packs", "pack", "pkt", "pkts", "packet", "packets" },
            new[] { "foot", "feet", "ft" },
            new[] { "gallon", "gallons", "gal" },
            new[] { "pound", "pounds", "lb", "lbs" },
        };

        private static readonly Dictionary<string, int> FamilyOf = BuildIndex();

        private static Dictionary<string, int> BuildIndex()
        {
            var index = new Dictionary<string, int>();
            for (var i = 0; i < Families.Length; i++)
                foreach (var spelling in Families[i])
                    index[spelling] = i;
            return index;
        }

        /// <summary>
        /// True when the operator's <paramref name="local"/> unit means FBR's
        /// <paramref name="fbrDescription"/>: same text ignoring case and
        /// punctuation, or two spellings of the same family.
        /// </summary>
        public static bool SameUnit(string? local, string? fbrDescription)
        {
            var l = Normalize(local);
            var f = Normalize(fbrDescription);
            if (l.Length == 0 || f.Length == 0) return false;
            if (l == f) return true;
            return FamilyOf.TryGetValue(l, out var a)
                && FamilyOf.TryGetValue(f, out var b)
                && a == b;
        }
    }
}
