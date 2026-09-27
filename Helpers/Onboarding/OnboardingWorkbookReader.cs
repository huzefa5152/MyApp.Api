using System.Globalization;
using System.Text.RegularExpressions;
using MyApp.Api.Helpers.ExcelImport;

namespace MyApp.Api.Helpers.Onboarding
{
    /// <summary>One data row, values keyed by <see cref="OnboardingColumn.Key"/>, all trimmed.</summary>
    public record ParsedRow(int RowNumber, IReadOnlyDictionary<string, string> Values)
    {
        public string Get(string key) => Values.TryGetValue(key, out var v) ? v : "";
    }

    /// <summary>
    /// One sheet as read. <see cref="Present"/> is false when the workbook has
    /// no sheet of that title. <see cref="MissingHeadings"/> lists required
    /// columns whose heading was not found — every row then fails on them.
    /// </summary>
    public record ParsedSheet(
        string Key,
        bool Present,
        IReadOnlyList<ParsedRow> Rows,
        IReadOnlyList<string> MissingHeadings,
        IReadOnlyList<string> Warnings,
        int DataRowCount);

    /// <summary>
    /// Reads the onboarding workbook through the format-agnostic
    /// <see cref="IImportedWorkbook"/>, so .xls and .xlsx behave alike.
    /// Columns are located by their HEADING, not their position: a reordered
    /// or inserted column still imports. The help row the sample carries under
    /// the headings is recognised and never read as data.
    /// </summary>
    public static class OnboardingWorkbookReader
    {
        private static readonly Regex Scientific = new(@"^-?\d+(\.\d+)?[eE][+-]?\d+$", RegexOptions.Compiled);

        public static Dictionary<string, ParsedSheet> Read(IImportedWorkbook wb, IEnumerable<string> sheetKeys)
        {
            var result = new Dictionary<string, ParsedSheet>(StringComparer.OrdinalIgnoreCase);
            foreach (var key in sheetKeys)
            {
                var sheet = OnboardingSchema.Find(key);
                if (sheet == null) continue;
                result[sheet.Key] = ReadSheet(wb, sheet);
            }
            return result;
        }

        public static string NormaliseHeading(string s) =>
            new string((s ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());

        private static int FindSheetIndex(IImportedWorkbook wb, OnboardingSheet sheet)
        {
            var wanted = new[] { NormaliseHeading(sheet.Title), NormaliseHeading(sheet.Key) };
            for (var i = 0; i < wb.WorksheetCount; i++)
                if (wanted.Contains(NormaliseHeading(wb.GetSheetName(i)))) return i;
            return -1;
        }

        private static ParsedSheet ReadSheet(IImportedWorkbook wb, OnboardingSheet sheet)
        {
            var idx = FindSheetIndex(wb, sheet);
            if (idx < 0)
                return new ParsedSheet(sheet.Key, false, Array.Empty<ParsedRow>(),
                    Array.Empty<string>(), Array.Empty<string>(), 0);

            var warnings = new List<string>();

            // Heading -> column number. A heading may carry the sample's " *"
            // marker or different spacing / case; NormaliseHeading drops both.
            var headingCols = new Dictionary<string, int>();
            for (var c = 1; c <= OnboardingSchema.MaxHeadingColumns; c++)
            {
                var h = NormaliseHeading(wb.GetString(idx, OnboardingSchema.HeaderRow, c));
                if (h.Length > 0 && !headingCols.ContainsKey(h)) headingCols[h] = c;
            }

            var columnOf = new Dictionary<string, int>();
            var missing = new List<string>();
            foreach (var col in sheet.Columns)
            {
                var names = new[] { col.Heading }.Concat(col.Aliases ?? Array.Empty<string>())
                    .Select(NormaliseHeading);
                var hit = names.Select(n => headingCols.TryGetValue(n, out var c) ? c : 0).FirstOrDefault(c => c > 0);
                if (hit > 0) columnOf[col.Key] = hit;
                else if (col.Requirement == Requirement.Required) missing.Add(col.Heading);
            }
            if (missing.Count > 0)
                warnings.Add($"Column {string.Join(", ", missing.Select(m => $"\"{m}\""))} was not found in row 1 of the {sheet.Title} sheet.");

            var rows = new List<ParsedRow>();
            var lastRow = wb.GetLastRow(idx);
            var dataRows = 0;
            for (var r = OnboardingSchema.HeaderRow + 1; r <= lastRow; r++)
            {
                var values = new Dictionary<string, string>();
                foreach (var col in sheet.Columns)
                {
                    if (!columnOf.TryGetValue(col.Key, out var c)) continue;
                    values[col.Key] = ReadCell(wb, idx, r, c, col.Kind);
                }
                if (values.Values.All(string.IsNullOrWhiteSpace)) continue;
                if (IsHelpRow(sheet, values)) continue;
                dataRows++;
                if (rows.Count < OnboardingSchema.MaxRowsPerSheet) rows.Add(new ParsedRow(r, values));
            }

            return new ParsedSheet(sheet.Key, true, rows, missing, warnings, dataRows);
        }

        /// <summary>
        /// A row whose every filled cell is one of this sheet's help texts is
        /// the sample's guidance line, wherever it sits. Any column's help, not
        /// only its own: an operator who reorders the headings leaves the help
        /// line where it was.
        /// </summary>
        private static bool IsHelpRow(OnboardingSheet sheet, Dictionary<string, string> values)
        {
            var filled = values.Values.Where(v => !string.IsNullOrWhiteSpace(v)).ToList();
            if (filled.Count == 0) return false;
            var helps = sheet.Columns.Select(c => NormaliseHeading(c.Help)).ToHashSet();
            return filled.All(v => helps.Contains(NormaliseHeading(v)));
        }

        private static string ReadCell(IImportedWorkbook wb, int idx, int r, int c, ColumnKind kind)
        {
            var text = wb.GetString(idx, r, c);
            switch (kind)
            {
                case ColumnKind.Identifier:
                    // 4230101968953 typed as a number reads back as 4.2301E+12.
                    if (Scientific.IsMatch(text))
                    {
                        var d = wb.GetDecimal(idx, r, c);
                        if (d.HasValue) return decimal.Truncate(d.Value).ToString("0", CultureInfo.InvariantCulture);
                    }
                    return text;
                case ColumnKind.Number:
                    if (text.Length == 0) return "";
                    var n = wb.GetDecimal(idx, r, c);
                    return n.HasValue ? n.Value.ToString(CultureInfo.InvariantCulture) : text;
                case ColumnKind.Date:
                    if (text.Length == 0) return "";
                    var dt = wb.GetDate(idx, r, c);
                    return dt.HasValue ? dt.Value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) : text;
                default:
                    return text;
            }
        }
    }
}
