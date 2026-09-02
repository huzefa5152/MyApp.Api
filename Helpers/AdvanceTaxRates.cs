namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Advance income tax collected FROM the buyer on a sale, under sections
    /// 236G (distributors / dealers / wholesalers) and 236H (retailers) of the
    /// Income Tax Ordinance.
    ///
    /// It is the mirror image of the withholding tax already on
    /// <see cref="Models.Invoice"/>: it sits ON TOP of sales tax, it is NOT part
    /// of the FBR sales-tax invoice (GrandTotal, GSTAmount and the PRAL payload
    /// are untouched), and it only changes what the customer pays —
    /// withholding reduces that figure, advance tax adds to it:
    ///
    ///     Collectible = GrandTotal − WithholdingTaxAmount + AdvanceTaxAmount
    ///
    /// The rate depends on whether the buyer is on FBR's Active Taxpayer List.
    /// The base is the amount INCLUDING sales tax, which is what the statute
    /// charges on: 100,000 + 18,000 sales tax = 118,000, and 236G at 0.1%
    /// collects 118.
    /// </summary>
    public static class AdvanceTaxRates
    {
        public const string Section236G = "236G";
        public const string Section236H = "236H";

        /// <summary>One selectable combination of section and filer status.</summary>
        public readonly record struct Option(string Section, bool FilerActive, decimal Rate)
        {
            /// <summary>What the dropdown shows, e.g. "236G — 0.1% (Active)".</summary>
            public string Label => $"{Section} — {Rate:0.###}% ({(FilerActive ? "Active" : "Non-Active")})";
        }

        /// <summary>
        /// The published rates. Kept in one table so the dropdown the operator
        /// picks from and the amount the server computes cannot drift apart,
        /// and so a rate change is a single edit here.
        /// </summary>
        public static readonly IReadOnlyList<Option> All = new List<Option>
        {
            new(Section236G, true,  0.1m),
            new(Section236H, true,  0.5m),
            new(Section236G, false, 2.0m),
            new(Section236H, false, 2.5m),
        };

        /// <summary>
        /// The rate for a section and filer status, or null when the pair is not
        /// one this system knows. Returning null rather than guessing keeps a
        /// mistyped section out of the tax figures.
        /// </summary>
        public static decimal? RateFor(string? section, bool? filerActive)
        {
            if (string.IsNullOrWhiteSpace(section) || filerActive is null) return null;
            var wanted = section.Trim();
            foreach (var o in All)
            {
                if (string.Equals(o.Section, wanted, StringComparison.OrdinalIgnoreCase)
                    && o.FilerActive == filerActive.Value)
                {
                    return o.Rate;
                }
            }
            return null;
        }

        /// <summary>
        /// How the section reads on a printed invoice. The client's format
        /// hyphenates it -- "Advanced Income Tax 236-G" -- while the stored
        /// value is the bare section code.
        /// </summary>
        public static string PrintLabel(string? section)
        {
            var s = (section ?? "").Trim().ToUpperInvariant();
            if (s.Length == 4 && s.StartsWith("236")) return "236-" + s[3];
            return s;
        }

        /// <summary>
        /// Advance tax on an amount that already includes sales tax, to the 2dp
        /// every stored amount in this system keeps.
        /// </summary>
        public static decimal Amount(decimal amountIncludingSalesTax, decimal? rate)
        {
            if (rate is null or <= 0m || amountIncludingSalesTax <= 0m) return 0m;
            return Math.Round(amountIncludingSalesTax * rate.Value / 100m, 2, MidpointRounding.AwayFromZero);
        }

        /// <summary>
        /// Resolves what to store from what the operator chose. A section with
        /// no matching rate is treated as "not selected" — the field is
        /// optional, and a half-chosen one must not silently charge the buyer.
        /// </summary>
        public static (string? Section, bool? FilerActive, decimal? Rate, decimal Amount) Resolve(
            string? section, bool? filerActive, decimal amountIncludingSalesTax)
        {
            var rate = RateFor(section, filerActive);
            if (rate is null) return (null, null, null, 0m);
            return (section!.Trim().ToUpperInvariant(), filerActive, rate,
                    Amount(amountIncludingSalesTax, rate));
        }
    }
}
