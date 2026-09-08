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

        /// <summary>
        /// Heading texts that identify a column wherever it happens to sit,
        /// keyed by the same names <see cref="Columns"/> serialises under.
        ///
        /// Column NUMBERS remain the contract; this only corrects them. Two
        /// accountants preparing the same customs-lot sheet agree on everything
        /// from the Price column rightwards and disagree about the four columns
        /// before it — one writes HS codes then the product name, the other
        /// product name then HS codes — and they name the same column "GD
        /// Number" or "GDs No". Fixed numbers made the second file import the
        /// heading "9506" as a product; an alias finds it either way, so ONE
        /// built-in layout covers both without the operator mapping anything.
        ///
        /// Deliberately conservative: a heading that matches no column, or more
        /// than one, leaves the mapped number alone. The balance block repeats
        /// "Qty" and "Rate" three times, so aliasing those correctly declines
        /// rather than guessing which band was meant.
        /// </summary>
        [JsonPropertyName("headerAliases")]
        public Dictionary<string, List<string>> HeaderAliases { get; set; } = new();

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

            /// <summary>
            /// Landed unit cost as the sheet states it. Kept per LOT, never
            /// merged: the stock position's unit cost is value / quantity and is
            /// already derived, so a weighted average of this column would say
            /// nothing new. What it records is what one customs declaration
            /// cost, which is the figure an accountant reconciles against.
            /// </summary>
            [JsonPropertyName("unitPrice")] public int? UnitPrice { get; set; }

            /// <summary>Opening block — what the lot arrived with, before any
            /// of it was consumed. The BALANCE columns drive the import; these
            /// are the history behind that balance.</summary>
            [JsonPropertyName("openingQty")] public int? OpeningQty { get; set; }
            [JsonPropertyName("openingValue")] public int? OpeningValue { get; set; }
            [JsonPropertyName("openingTaxRate")] public int? OpeningTaxRate { get; set; }

            /// <summary>Consumed block — what has gone out of the lot.</summary>
            [JsonPropertyName("consumedQty")] public int? ConsumedQty { get; set; }
            [JsonPropertyName("consumedValue")] public int? ConsumedValue { get; set; }
            [JsonPropertyName("consumedTaxRate")] public int? ConsumedTaxRate { get; set; }
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

        // ── Heading-driven column resolution ─────────────────────────────────

        /// <summary>Setters for every column an alias may point at, keyed by the
        /// field's JSON name. Explicit rather than reflected so a renamed
        /// property fails to compile instead of silently stopping working.</summary>
        private static readonly Dictionary<string, Action<LotRowsColumns, int>> Setters =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["itemName"] = (c, v) => c.ItemName = v,
                ["hsCodeFull"] = (c, v) => c.HsCodeFull = v,
                ["hsCodeShort"] = (c, v) => c.HsCodeShort = v,
                ["unit"] = (c, v) => c.Unit = v,
                ["balanceQty"] = (c, v) => c.BalanceQty = v,
                ["balanceValue"] = (c, v) => c.BalanceValue = v,
                ["balanceTaxRate"] = (c, v) => c.BalanceTaxRate = v,
                ["balanceTax"] = (c, v) => c.BalanceTax = v,
                ["lotRef"] = (c, v) => c.LotRef = v,
                ["lotDate"] = (c, v) => c.LotDate = v,
                ["unitPrice"] = (c, v) => c.UnitPrice = v,
                ["openingQty"] = (c, v) => c.OpeningQty = v,
                ["openingValue"] = (c, v) => c.OpeningValue = v,
                ["openingTaxRate"] = (c, v) => c.OpeningTaxRate = v,
                ["consumedQty"] = (c, v) => c.ConsumedQty = v,
                ["consumedValue"] = (c, v) => c.ConsumedValue = v,
                ["consumedTaxRate"] = (c, v) => c.ConsumedTaxRate = v,
            };

        /// <summary>Columns of the heading row that are read looking for aliases.</summary>
        private const int AliasScanCols = 60;

        /// <summary>
        /// Every column the mapping points at, and which fields point at it.
        /// Used to report a column two fields would read.
        /// </summary>
        private static List<int> MappedColumns(
            LotRowsColumns c, out Dictionary<int, List<string>> byColumn)
        {
            var pairs = new (string Field, int? Col)[]
            {
                ("itemName", c.ItemName), ("balanceQty", c.BalanceQty),
                ("hsCodeFull", c.HsCodeFull), ("hsCodeShort", c.HsCodeShort), ("unit", c.Unit),
                ("balanceValue", c.BalanceValue), ("balanceTaxRate", c.BalanceTaxRate),
                ("balanceTax", c.BalanceTax), ("lotRef", c.LotRef), ("lotDate", c.LotDate),
                ("unitPrice", c.UnitPrice),
                ("openingQty", c.OpeningQty), ("openingValue", c.OpeningValue),
                ("openingTaxRate", c.OpeningTaxRate),
                ("consumedQty", c.ConsumedQty), ("consumedValue", c.ConsumedValue),
                ("consumedTaxRate", c.ConsumedTaxRate),
            };

            byColumn = pairs
                .Where(p => p.Col is > 0)
                .GroupBy(p => p.Col!.Value)
                .ToDictionary(g => g.Key, g => g.Select(p => p.Field).ToList());

            return byColumn.Keys.OrderBy(k => k).ToList();
        }

        /// <summary>Lower-cased, punctuation-free form, so "8 Digit Hs Code",
        /// "8-digit HS code" and "8DigitHSCode" are one heading.</summary>
        private static string Normalise(string? text) =>
            new string((text ?? "").Where(char.IsLetterOrDigit).ToArray()).ToLowerInvariant();

        /// <summary>
        /// Returns the columns to read with, after letting
        /// <see cref="HeaderAliases"/> correct them against the sheet's own
        /// heading row. <paramref name="notes"/> records every correction so the
        /// preview can say a column was found somewhere other than where the
        /// layout expected it — a silent relocation is how a wrong column
        /// becomes a confident wrong import.
        /// </summary>
        public LotRowsColumns ResolveColumns(IImportedWorkbook workbook, int sheet, out List<string> notes)
        {
            notes = new List<string>();

            var resolved = new LotRowsColumns
            {
                ItemName = Columns.ItemName,
                HsCodeFull = Columns.HsCodeFull,
                HsCodeShort = Columns.HsCodeShort,
                Unit = Columns.Unit,
                BalanceQty = Columns.BalanceQty,
                BalanceValue = Columns.BalanceValue,
                BalanceTaxRate = Columns.BalanceTaxRate,
                BalanceTax = Columns.BalanceTax,
                LotRef = Columns.LotRef,
                LotDate = Columns.LotDate,
                UnitPrice = Columns.UnitPrice,
                OpeningQty = Columns.OpeningQty,
                OpeningValue = Columns.OpeningValue,
                OpeningTaxRate = Columns.OpeningTaxRate,
                ConsumedQty = Columns.ConsumedQty,
                ConsumedValue = Columns.ConsumedValue,
                ConsumedTaxRate = Columns.ConsumedTaxRate,
            };

            if (HeaderAliases.Count == 0 || HeaderRow <= 0) return resolved;

            // Heading text of the row, once.
            var headings = new Dictionary<int, string>();
            for (int col = 1; col <= AliasScanCols; col++)
            {
                var text = Normalise(workbook.GetString(sheet, HeaderRow, col));
                if (text.Length > 0) headings[col] = text;
            }
            if (headings.Count == 0) return resolved;

            // Every alias is resolved against the headings FIRST and applied
            // afterwards. Applying them one at a time cannot express a SWAP: on
            // the second column order the item name moves from 6 to 4 and the
            // 4-digit code from 4 to 6, and whichever moved first would find the
            // other's column occupied and decline — leaving the layout half
            // corrected, which reads a heading as a product name.
            var found = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var (field, aliases) in HeaderAliases)
            {
                if (!Setters.ContainsKey(field) || aliases == null || aliases.Count == 0) continue;

                var wanted = aliases.Select(Normalise).Where(a => a.Length > 0).ToHashSet();
                if (wanted.Count == 0) continue;

                var hits = headings.Where(h => wanted.Contains(h.Value)).Select(h => h.Key).ToList();
                if (hits.Count == 0) continue;
                if (hits.Count > 1)
                {
                    notes.Add($"\"{aliases[0]}\" appears in {hits.Count} columns, so column {CurrentColumn(resolved, field)} was kept.");
                    continue;
                }

                found[field] = hits[0];
            }

            // Two fields naming one column means the aliases are wrong, not the
            // sheet. Drop both rather than let the later one win.
            foreach (var group in found.GroupBy(f => f.Value).Where(g => g.Count() > 1).ToList())
            {
                notes.Add($"Column {group.Key} matched more than one heading ({string.Join(", ", group.Select(g => g.Key))}), so the mapped columns were kept.");
                foreach (var f in group) found.Remove(f.Key);
            }

            foreach (var (field, col) in found)
            {
                var current = CurrentColumn(resolved, field);
                if (current == col) continue;       // already where the layout said

                Setters[field](resolved, col);
                notes.Add($"\"{HeaderAliases[field][0]}\" was read from column {col}" +
                          (current is > 0 ? $" instead of column {current}." : "."));
            }

            // A number left pointing at a column an alias has taken over would
            // read the same cells twice. Worth saying, not worth refusing —
            // the mapped column may genuinely hold a second copy.
            var duplicated = MappedColumns(resolved, out var byColumn)
                .Where(c => byColumn[c].Count > 1)
                .ToList();
            foreach (var col in duplicated)
                notes.Add($"Column {col} is mapped to more than one field ({string.Join(", ", byColumn[col])}). Check the layout.");

            return resolved;
        }

        /// <summary>
        /// Heading words this layout knows about, normalised. Every alias, plus
        /// the fixed vocabulary of the blocks that are pinned by position and so
        /// have no aliases of their own.
        /// </summary>
        private static readonly string[] AlwaysHeadings =
        {
            "qty", "rate", "stax", "salestax", "exl", "excl", "balqty", "balexl",
            "consumedexl", "price", "unit", "uom", "description", "items", "item",
            "itemname", "particulars", "subcategory", "subcat", "claimmonth",
            "gdnumber", "gdsno", "gdno", "gddate", "4digithscode", "8digithscode",
        };

        /// <summary>
        /// True when this text is one of the layout's own column HEADINGS rather
        /// than a value.
        ///
        /// The reader needs this because <c>headerRow</c> cannot be trusted to
        /// locate the heading row. A layout saved with <c>headerRow: 1</c> and
        /// <c>firstDataRow: 3</c> against a sheet whose headings are on row 3
        /// puts the heading row squarely inside the data range, and no
        /// arithmetic on those two numbers can tell. It arrives as a product
        /// called "Description" with HS code "8" and no quantity — which is
        /// exactly what a real import produced.
        /// </summary>
        public bool LooksLikeHeadingText(string? text)
        {
            var t = Normalise(text);
            if (t.Length == 0) return false;
            if (AlwaysHeadings.Contains(t)) return true;
            foreach (var aliases in HeaderAliases.Values)
                foreach (var a in aliases ?? new List<string>())
                    if (Normalise(a) == t) return true;
            return false;
        }

        private static int? CurrentColumn(LotRowsColumns c, string field) => field.ToLowerInvariant() switch
        {
            "itemname" => c.ItemName,
            "hscodefull" => c.HsCodeFull,
            "hscodeshort" => c.HsCodeShort,
            "unit" => c.Unit,
            "balanceqty" => c.BalanceQty,
            "balancevalue" => c.BalanceValue,
            "balancetaxrate" => c.BalanceTaxRate,
            "balancetax" => c.BalanceTax,
            "lotref" => c.LotRef,
            "lotdate" => c.LotDate,
            "unitprice" => c.UnitPrice,
            "openingqty" => c.OpeningQty,
            "openingvalue" => c.OpeningValue,
            "openingtaxrate" => c.OpeningTaxRate,
            "consumedqty" => c.ConsumedQty,
            "consumedvalue" => c.ConsumedValue,
            "consumedtaxrate" => c.ConsumedTaxRate,
            _ => null,
        };
    }
}
