using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Mapping for the <c>LotRows</c> opening-stock layout: one row per customs
    /// lot, so an item held across two declarations occupies two rows whose
    /// quantities have to be added together.
    ///
    /// Column numbers are 1-based, matching <see cref="IImportedWorkbook"/>.
    /// </summary>
    public class LotRowsMapping
    {
        [JsonPropertyName("sheetSelect")]
        public SheetSelector SheetSelect { get; set; } = new();

        /// <summary>Row carrying the column headings. Informational — the
        /// importer reads by column number, not by heading — but it is what the
        /// mapping UI highlights, and it bounds <see cref="FirstDataRow"/>.</summary>
        [JsonPropertyName("headerRow")]
        public int HeaderRow { get; set; } = 1;

        [JsonPropertyName("firstDataRow")]
        public int FirstDataRow { get; set; } = 2;

        [JsonPropertyName("columns")]
        public LotRowsColumns Columns { get; set; } = new();

        /// <summary>
        /// Trailing junk to cut off an HS code. Real sheets carry decoration —
        /// Alpha Traders' codes read <c>8481.1000:-</c> — and a code that keeps
        /// it will never match the tariff master.
        /// </summary>
        [JsonPropertyName("hsCodeStripSuffix")]
        public string? HsCodeStripSuffix { get; set; }

        /// <summary>
        /// Columns deliberately not imported. Recorded rather than simply left
        /// out of <see cref="Columns"/> so the mapping UI can show them as a
        /// decision someone made, not an oversight.
        /// </summary>
        [JsonPropertyName("ignoreColumns")]
        public List<int> IgnoreColumns { get; set; } = new();

        /// <summary>
        /// Stop after this many consecutive blank rows. Sheets frequently carry
        /// a formatted-but-empty tail, and reading to <c>GetLastRow</c> would
        /// walk thousands of them.
        /// </summary>
        [JsonPropertyName("blankRowsEndData")]
        public int BlankRowsEndData { get; set; } = 15;

        public class LotRowsColumns
        {
            [JsonPropertyName("itemName")] public int ItemName { get; set; }
            [JsonPropertyName("hsCodeFull")] public int? HsCodeFull { get; set; }
            [JsonPropertyName("hsCodeShort")] public int? HsCodeShort { get; set; }
            [JsonPropertyName("unit")] public int? Unit { get; set; }
            [JsonPropertyName("balanceQty")] public int BalanceQty { get; set; }
            [JsonPropertyName("balanceValue")] public int? BalanceValue { get; set; }

            /// <summary>Sales tax RATE column. These sheets write it as a
            /// fraction (0.18); the importer converts to a percentage.</summary>
            [JsonPropertyName("balanceTaxRate")] public int? BalanceTaxRate { get; set; }

            /// <summary>Sales tax AMOUNT column. Read only to check it against
            /// value × rate — the amount itself is always derived, so importing
            /// it as a third stored number would give it room to drift.</summary>
            [JsonPropertyName("balanceTax")] public int? BalanceTax { get; set; }
            [JsonPropertyName("lotRef")] public int? LotRef { get; set; }
            [JsonPropertyName("lotDate")] public int? LotDate { get; set; }
        }

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        /// <summary>
        /// Reads a stored mapping. Throws <see cref="InvalidOperationException"/>
        /// with an operator-facing message when the mapping could not drive an
        /// import — checked here rather than at read time so a half-described
        /// layout fails on the mapping screen, not three steps later against a
        /// column of nulls.
        /// </summary>
        public static LotRowsMapping Parse(string? mappingJson)
        {
            LotRowsMapping? mapping;
            try
            {
                mapping = JsonSerializer.Deserialize<LotRowsMapping>(
                    string.IsNullOrWhiteSpace(mappingJson) ? "{}" : mappingJson, JsonOptions);
            }
            catch (JsonException)
            {
                throw new InvalidOperationException("The column mapping for this layout is not valid JSON.");
            }

            mapping ??= new LotRowsMapping();

            if (mapping.Columns.ItemName <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the item name.");
            if (mapping.Columns.BalanceQty <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the closing quantity.");
            if (mapping.Columns.HsCodeFull is null or <= 0 && mapping.Columns.HsCodeShort is null or <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the HS code.");
            if (mapping.FirstDataRow <= 0)
                throw new InvalidOperationException("The mapping does not say which row the data starts on.");

            return mapping;
        }

        /// <summary>
        /// A starting point for an unrecognised workbook, matching the shape
        /// these sheets almost always take. The operator corrects it on the
        /// mapping screen — it exists so they are editing something rather than
        /// filling in eight empty boxes.
        /// </summary>
        public static LotRowsMapping Scaffold() => new()
        {
            SheetSelect = new SheetSelector { Mode = SheetSelector.ByIndex, Index = 0 },
            HeaderRow = 1,
            FirstDataRow = 2,
            Columns = new LotRowsColumns { ItemName = 1, HsCodeFull = 2, Unit = 3, BalanceQty = 4, BalanceValue = 5 },
        };

        public string ToJson() => JsonSerializer.Serialize(this, JsonOptions);
    }
}
