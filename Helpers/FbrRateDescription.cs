using System.Globalization;
using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Takes apart one of FBR's published rate descriptions (<c>ratE_DESC</c>
    /// from <c>SaleTypeToRate</c>).
    ///
    /// A "rate" at FBR is not always a percentage. Their own published strings
    /// include all of these shapes:
    ///
    ///   "18%"                                    plain ad valorem
    ///   "Exempt"                                 no tax at all
    ///   "Rs.2" / "Rs.10"                         a fixed amount
    ///   "18% along with rupees 60 per kilogram"  COMPOUND
    ///   "18% and Rs. 80 per Liter"               COMPOUND
    ///
    /// The compound ones are the reason this exists. A supply of Potassium
    /// Chlorate is taxed at 18% of the value PLUS Rs.60 for every kilogram, and
    /// FBR checks the arithmetic: filing only the 18% part is refused with
    /// [0103] "Provided sales tax amount does not match the calculated sales tax
    /// amount in case where sale type is ...". Nothing in the invoice can
    /// express that — <c>Invoice.GSTRate</c> is a single percentage — so the
    /// per-unit leg has to be read back out of FBR's own wording.
    ///
    /// Only ever used to READ what FBR published. Never build one of these
    /// strings (CLAUDE.md §10b: RESOLVE the value, never spell it).
    /// </summary>
    public static class FbrRateDescription
    {
        /// <param name="Percent">The ad valorem leg, e.g. 18 for "18% and Rs. 80 per Liter". Zero when there is none.</param>
        /// <param name="PerUnitAmount">The specific leg, e.g. 80. Zero when there is none.</param>
        /// <param name="PerUnitLabel">The unit that amount is per, e.g. "Liter" — for messages, never for arithmetic.</param>
        public readonly record struct Parts(decimal Percent, decimal PerUnitAmount, string PerUnitLabel)
        {
            /// <summary>True only when BOTH legs are present, which is the case
            /// the invoice cannot represent on its own.</summary>
            public bool IsCompound => Percent > 0m && PerUnitAmount > 0m;
        }

        // "18%" — the ad valorem leg.
        private static readonly Regex PercentRx = new(
            @"(\d+(?:\.\d+)?)\s*%", RegexOptions.Compiled);

        // "Rs. 80 per Liter", "rupees 60 per kilogram". The currency word is
        // optional because FBR is not consistent about it; the "per <unit>" is
        // not, since that is what makes the amount specific rather than fixed.
        private static readonly Regex PerUnitRx = new(
            @"(?:rs\.?|rupees)?\s*(\d+(?:\.\d+)?)\s*per\s+([A-Za-z]+)",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static Parts Parse(string? rateDesc)
        {
            if (string.IsNullOrWhiteSpace(rateDesc)) return default;

            var percent = 0m;
            var pm = PercentRx.Match(rateDesc);
            if (pm.Success)
                decimal.TryParse(pm.Groups[1].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out percent);

            var perUnit = 0m;
            var label = "";
            var um = PerUnitRx.Match(rateDesc);
            if (um.Success)
            {
                decimal.TryParse(um.Groups[1].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out perUnit);
                label = um.Groups[2].Value;
            }

            return new Parts(percent, perUnit, label);
        }
    }
}
