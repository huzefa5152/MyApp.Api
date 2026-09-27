using System.Globalization;
using System.Text.RegularExpressions;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Reads the "Claim Month" an accountant types on a stock sheet.
    ///
    /// The same sheet spells one month several ways — "Jun 2024", "June 2026",
    /// "March 2025", "Sept 2025", "Jun-24" — so the month is found by its
    /// three-letter short name rather than an exact format: "June", "Jun" and
    /// "JUNE" are all "jun". Numeric forms ("06/2024", "2024-06") and a real
    /// date cell are accepted too. Anything else is "not claimed yet", never a
    /// guess — a wrong month here moves a GD's input tax into another return.
    /// </summary>
    public static class ClaimMonthParser
    {
        private static readonly string[] Short =
            { "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec" };

        private static readonly Regex NameYear = new(
            @"^\s*([A-Za-z]{3,9})[\s\-/.,']*(\d{2}|\d{4})\s*$", RegexOptions.Compiled);
        private static readonly Regex MonthYear = new(
            @"^\s*(\d{1,2})\s*[\-/.]\s*(\d{4})\s*$", RegexOptions.Compiled);
        private static readonly Regex YearMonth = new(
            @"^\s*(\d{4})\s*[\-/.]\s*(\d{1,2})(?:\s*[\-/.]\s*\d{1,2})?\s*$", RegexOptions.Compiled);

        /// <summary>First day of the claimed month, or null when the text does
        /// not name one.</summary>
        public static DateTime? Parse(string? text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var t = text.Trim();

            var m = NameYear.Match(t);
            if (m.Success)
            {
                var name = m.Groups[1].Value.ToLowerInvariant();
                var idx = Array.IndexOf(Short, name[..3]);
                // "Mayo" or "Junk 2024" must not pass as a month: the full word
                // has to be a prefix of the real name ("sept" of "september").
                if (idx < 0 || !CultureInfo.InvariantCulture.DateTimeFormat.MonthNames[idx]
                        .StartsWith(name, StringComparison.OrdinalIgnoreCase))
                    return null;
                return Build(ExpandYear(m.Groups[2].Value), idx + 1);
            }

            m = MonthYear.Match(t);
            if (m.Success) return Build(int.Parse(m.Groups[2].Value), int.Parse(m.Groups[1].Value));

            m = YearMonth.Match(t);
            if (m.Success) return Build(int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value));

            return null;
        }

        /// <summary>A date cell names its month directly.</summary>
        public static DateTime? FromDate(DateTime? date) =>
            date is { } d && d.Year >= 2000 ? new DateTime(d.Year, d.Month, 1) : null;

        private static int ExpandYear(string y) => y.Length == 2 ? 2000 + int.Parse(y) : int.Parse(y);

        private static DateTime? Build(int year, int month) =>
            year is >= 2000 and <= 2100 && month is >= 1 and <= 12 ? new DateTime(year, month, 1) : null;
    }
}
