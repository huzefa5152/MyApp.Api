using System.Text.Json.Serialization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// How a layout finds the worksheet it wants. Stored inside a profile's
    /// mapping, so it is data rather than code and a new workbook whose data
    /// sits on a differently-named tab needs no new strategy.
    ///
    /// A sheet INDEX alone is not enough in practice: the same monthly workbook
    /// gains a "Notes" or "Settings" tab and every index shifts by one. Matching
    /// by name or by the header text actually present survives that, which is
    /// why those modes exist and why index is the last resort.
    /// </summary>
    public class SheetSelector
    {
        public const string ByName = "byName";
        public const string ByIndex = "byIndex";
        public const string ByHeaderText = "byHeaderText";
        public const string AllExcept = "allExcept";

        [JsonPropertyName("mode")]
        public string Mode { get; set; } = ByHeaderText;

        /// <summary>Sheet name for <see cref="ByName"/> (case-insensitive).</summary>
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        /// <summary>0-based sheet index for <see cref="ByIndex"/>.</summary>
        [JsonPropertyName("index")]
        public int? Index { get; set; }

        /// <summary>For <see cref="ByHeaderText"/>: every one of these must
        /// appear somewhere in the sheet's first rows. All of them, not any —
        /// a single common word like "Date" matches nearly every sheet.</summary>
        [JsonPropertyName("mustContain")]
        public List<string> MustContain { get; set; } = new();

        /// <summary>For <see cref="AllExcept"/>: sheet names to skip; every
        /// other sheet is selected.</summary>
        [JsonPropertyName("except")]
        public List<string> Except { get; set; } = new();

        /// <summary>Rows scanned when looking for header text.</summary>
        private const int HeaderScanRows = 10;
        private const int HeaderScanCols = 40;

        /// <summary>
        /// The single sheet this selector points at, or -1 when nothing
        /// matches. Callers report that as a mapping problem rather than
        /// silently falling back to sheet 0 — reading the wrong sheet produces
        /// a confident, wrong import.
        /// </summary>
        public int ResolveOne(IImportedWorkbook workbook)
        {
            var all = ResolveMany(workbook);
            return all.Count == 0 ? -1 : all[0];
        }

        /// <summary>Every sheet this selector points at, in workbook order.</summary>
        public List<int> ResolveMany(IImportedWorkbook workbook)
        {
            var hits = new List<int>();

            for (int i = 0; i < workbook.WorksheetCount; i++)
            {
                var sheetName = workbook.GetSheetName(i) ?? "";

                var match = Mode switch
                {
                    ByName => string.Equals(sheetName.Trim(), Name?.Trim(), StringComparison.OrdinalIgnoreCase),
                    ByIndex => Index.HasValue && i == Index.Value,
                    AllExcept => !Except.Any(e => string.Equals(e.Trim(), sheetName.Trim(), StringComparison.OrdinalIgnoreCase)),
                    ByHeaderText => HasAllHeaderText(workbook, i),
                    _ => false,
                };

                if (match) hits.Add(i);
            }

            return hits;
        }

        private bool HasAllHeaderText(IImportedWorkbook workbook, int sheet)
        {
            if (MustContain.Count == 0) return false;

            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var lastRow = Math.Min(workbook.GetLastRow(sheet), HeaderScanRows);

            for (int row = 1; row <= lastRow; row++)
                for (int col = 1; col <= HeaderScanCols; col++)
                {
                    var text = workbook.GetString(sheet, row, col);
                    if (string.IsNullOrWhiteSpace(text)) continue;

                    foreach (var needle in MustContain)
                        if (text.Contains(needle.Trim(), StringComparison.OrdinalIgnoreCase))
                            seen.Add(needle.Trim());
                }

            return MustContain.All(n => seen.Contains(n.Trim()));
        }
    }
}
