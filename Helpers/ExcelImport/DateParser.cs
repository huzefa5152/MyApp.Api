using System.Globalization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Loose date parser that handles the common hand-entered formats in old
    /// challan/bill spreadsheets: dd/MM/yyyy, d-MMM-yyyy, MM/dd/yyyy, etc.
    /// Invariant-culture so behavior is deterministic across deploy environments.
    /// </summary>
    internal static class DateParser
    {
        private static readonly string[] Formats = new[]
        {
            "dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy",
            "dd.MM.yyyy", "d.M.yyyy",
            "yyyy-MM-dd", "yyyy/MM/dd",
            "dd-MMM-yyyy", "d-MMM-yyyy", "dd MMM yyyy", "d MMM yyyy",
            "dd-MMMM-yyyy", "d-MMMM-yyyy", "dd MMMM yyyy", "d MMMM yyyy",
            "MM/dd/yyyy", "M/d/yyyy",
            "dd/MM/yy", "d/M/yy", "dd-MM-yy"
        };

        public static DateTime? TryParseLoose(string? input)
        {
            if (string.IsNullOrWhiteSpace(input)) return null;
            var s = input.Trim();

            if (DateTime.TryParseExact(s, Formats, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var exact))
                return exact;

            if (DateTime.TryParse(s, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var loose))
                return loose;

            return null;
        }
    }
}
