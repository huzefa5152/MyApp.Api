using System.Text.Json;
using System.Text.Json.Serialization;

namespace MyApp.Api.Helpers.ExcelImport
{
    /// <summary>
    /// Mapping for the <c>GdRows</c> layout: a customs GD costing sheet, one row
    /// per consignment line, with the GD number repeated on every row of the
    /// consignment.
    ///
    /// Column numbers are 1-based and are the contract;
    /// <see cref="HeaderAliases"/> corrects them against the sheet's own heading
    /// row. Three real client workbooks share this layout and disagree about
    /// three things: AY inserts a "PNL/FIN" column that shifts everything from
    /// Subtotal rightwards by one, PAK titles the cost column "Cost Valve" where
    /// the others say "Value", and PAK titles the input-tax column "S.Tax" where
    /// the others say "Total Tax Amt For Selling Value". Aliases absorb all
    /// three, so there is ONE built-in layout and no operator mapping.
    /// </summary>
    public class GdCostingMapping
    {
        [JsonPropertyName("sheetSelect")] public SheetSelector SheetSelect { get; set; } = new();

        /// <summary>Row carrying the column headings. Informational - the
        /// importer reads by column number, not by heading - but it is what
        /// <see cref="Resolve"/> scans for aliases.</summary>
        [JsonPropertyName("headerRow")] public int HeaderRow { get; set; } = 1;

        [JsonPropertyName("firstDataRow")] public int FirstDataRow { get; set; } = 3;

        [JsonPropertyName("columns")] public GdCostingColumns Columns { get; set; } = new();

        /// <summary>
        /// Stop after this many consecutive blank rows. Sheets frequently carry
        /// a formatted-but-empty tail, and reading to the sheet's last row would
        /// walk thousands of them.
        /// </summary>
        [JsonPropertyName("blankRowsEndData")] public int BlankRowsEndData { get; set; } = 15;

        /// <summary>
        /// Heading texts that identify a column wherever it happens to sit,
        /// keyed by the same names <see cref="Columns"/> serialises under.
        ///
        /// Column NUMBERS remain the contract; this only corrects them against
        /// the sheet's own heading row - see the class summary for the three
        /// ways the real workbooks disagree. Deliberately conservative: a
        /// heading that matches no column, or more than one, leaves the mapped
        /// number alone (see <see cref="Resolve"/>).
        /// </summary>
        [JsonPropertyName("headerAliases")]
        public Dictionary<string, List<string>> HeaderAliases { get; set; } = new();

        public class GdCostingColumns
        {
            [JsonPropertyName("gdNumber")] public int GdNumber { get; set; }
            [JsonPropertyName("gdDate")] public int? GdDate { get; set; }
            [JsonPropertyName("description")] public int Description { get; set; }
            [JsonPropertyName("quantity")] public int Quantity { get; set; }
            [JsonPropertyName("unit")] public int? Unit { get; set; }
            [JsonPropertyName("hsCode")] public int HsCode { get; set; }
            [JsonPropertyName("assessedValue")] public int AssessedValue { get; set; }
            [JsonPropertyName("customsDuty")] public int? CustomsDuty { get; set; }
            [JsonPropertyName("acd")] public int? Acd { get; set; }
            [JsonPropertyName("regulatoryDuty")] public int? RegulatoryDuty { get; set; }
            [JsonPropertyName("others")] public int? Others { get; set; }
            [JsonPropertyName("salesTaxRate")] public int? SalesTaxRate { get; set; }
            [JsonPropertyName("astRate")] public int? AstRate { get; set; }
            [JsonPropertyName("incomeTaxRate")] public int? IncomeTaxRate { get; set; }
            [JsonPropertyName("addOnProfit")] public int? AddOnProfit { get; set; }

            /// <summary>
            /// The sheet's own Selling Value. Read so a MANUAL OVERRIDE survives:
            /// nine of PAK's 83 lines carry a typed selling value that the
            /// formula does not produce (ratios of 1.39, 1.33 and 1.56 against a
            /// computed 1.1667). The sheet wins, and the preview says so.
            /// </summary>
            [JsonPropertyName("sellingValue")] public int? SellingValue { get; set; }
        }

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        /// <summary>
        /// Reads a stored mapping. Throws <see cref="InvalidOperationException"/>
        /// with an operator-facing message when the mapping could not drive an
        /// import - checked here rather than at read time so a half-described
        /// layout fails immediately, not three steps later against a column of
        /// nulls.
        /// </summary>
        public static GdCostingMapping Parse(string? mappingJson)
        {
            GdCostingMapping? mapping;
            try
            {
                mapping = JsonSerializer.Deserialize<GdCostingMapping>(
                    string.IsNullOrWhiteSpace(mappingJson) ? "{}" : mappingJson, JsonOptions);
            }
            catch (JsonException)
            {
                throw new InvalidOperationException("The column mapping for this layout is not valid JSON.");
            }

            mapping ??= new GdCostingMapping();

            if (mapping.Columns.GdNumber <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the GD number.");
            if (mapping.Columns.Description <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the description.");
            if (mapping.Columns.Quantity <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the quantity.");
            if (mapping.Columns.HsCode <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the HS code.");
            if (mapping.Columns.AssessedValue <= 0)
                throw new InvalidOperationException("The mapping does not say which column holds the assessed value.");
            if (mapping.FirstDataRow <= 0)
                throw new InvalidOperationException("The mapping does not say which row the data starts on.");

            return mapping;
        }

        /// <summary>
        /// Strips a code down to digits and dots. Real sheets decorate them -
        /// every code in all three workbooks reads "8205.4000:-" - and a code
        /// that keeps its decoration matches nothing in the tariff master.
        /// </summary>
        public static string CleanHsCode(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "";
            var kept = new string(raw.Where(c => char.IsDigit(c) || c == '.').ToArray());
            return kept.Trim('.');
        }

        /// <summary>
        /// True for a row that sums the consignment rather than describing a
        /// line of it.
        ///
        /// BOTH halves are required. Row 30 of the Alpha sheet carries the GD
        /// number and a cost of 18,816,870 - the sum of the 26 lines above it -
        /// with no description and no selling value; imported as a line it
        /// doubles the consignment. Testing the value alone would drop a
        /// genuine zero-value line, and testing the description alone would
        /// keep a totals row that happened to be labelled.
        /// </summary>
        public static bool LooksLikeTotalsRow(string? description, decimal? sellingValue)
            => string.IsNullOrWhiteSpace(description) && !(sellingValue > 0m);

        // -- Heading-driven column resolution ------------------------------
        //
        // Mirrors LotRowsMapping.ResolveColumns exactly in structure -- same
        // five rules, renamed to this layout's fields:
        //   1. scan HeaderRow once, normalising each heading
        //   2. resolve every alias against those headings into `found` BEFORE
        //      applying any of them (applying one at a time cannot express a
        //      column swap)
        //   3. an alias matching zero columns, or more than one, leaves the
        //      mapped number alone and adds a note
        //   4. two fields resolving to the same column drops both and adds a
        //      note -- the aliases are wrong, not the sheet
        //   5. every relocation adds a note naming the old and new column

        /// <summary>Setters for every column an alias may point at, keyed by the
        /// field's JSON name. Explicit rather than reflected so a renamed
        /// property fails to compile instead of silently stopping working.</summary>
        private static readonly Dictionary<string, Action<GdCostingColumns, int>> Setters =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["gdNumber"] = (c, v) => c.GdNumber = v,
                ["gdDate"] = (c, v) => c.GdDate = v,
                ["description"] = (c, v) => c.Description = v,
                ["quantity"] = (c, v) => c.Quantity = v,
                ["unit"] = (c, v) => c.Unit = v,
                ["hsCode"] = (c, v) => c.HsCode = v,
                ["assessedValue"] = (c, v) => c.AssessedValue = v,
                ["customsDuty"] = (c, v) => c.CustomsDuty = v,
                ["acd"] = (c, v) => c.Acd = v,
                ["regulatoryDuty"] = (c, v) => c.RegulatoryDuty = v,
                ["others"] = (c, v) => c.Others = v,
                ["salesTaxRate"] = (c, v) => c.SalesTaxRate = v,
                ["astRate"] = (c, v) => c.AstRate = v,
                ["incomeTaxRate"] = (c, v) => c.IncomeTaxRate = v,
                ["addOnProfit"] = (c, v) => c.AddOnProfit = v,
                ["sellingValue"] = (c, v) => c.SellingValue = v,
            };

        /// <summary>Columns of the heading row that are read looking for aliases.</summary>
        private const int AliasScanCols = 60;

        /// <summary>
        /// Every column the mapping points at, and which fields point at it.
        /// Used to report a column two fields would read.
        /// </summary>
        private static List<int> MappedColumns(
            GdCostingColumns c, out Dictionary<int, List<string>> byColumn)
        {
            var pairs = new (string Field, int? Col)[]
            {
                ("gdNumber", c.GdNumber), ("gdDate", c.GdDate),
                ("description", c.Description), ("quantity", c.Quantity),
                ("unit", c.Unit), ("hsCode", c.HsCode),
                ("assessedValue", c.AssessedValue), ("customsDuty", c.CustomsDuty),
                ("acd", c.Acd), ("regulatoryDuty", c.RegulatoryDuty),
                ("others", c.Others), ("salesTaxRate", c.SalesTaxRate),
                ("astRate", c.AstRate), ("incomeTaxRate", c.IncomeTaxRate),
                ("addOnProfit", c.AddOnProfit), ("sellingValue", c.SellingValue),
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
        /// heading row. Every correction is appended to <paramref name="notes"/>
        /// (supplied by the caller, not created here) so the preview can say a
        /// column was found somewhere other than where the layout expected it -
        /// a silent relocation is how a wrong column becomes a confident wrong
        /// import.
        /// </summary>
        public GdCostingColumns Resolve(IImportedWorkbook wb, int sheet, List<string> notes)
        {
            notes ??= new List<string>();

            var resolved = new GdCostingColumns
            {
                GdNumber = Columns.GdNumber,
                GdDate = Columns.GdDate,
                Description = Columns.Description,
                Quantity = Columns.Quantity,
                Unit = Columns.Unit,
                HsCode = Columns.HsCode,
                AssessedValue = Columns.AssessedValue,
                CustomsDuty = Columns.CustomsDuty,
                Acd = Columns.Acd,
                RegulatoryDuty = Columns.RegulatoryDuty,
                Others = Columns.Others,
                SalesTaxRate = Columns.SalesTaxRate,
                AstRate = Columns.AstRate,
                IncomeTaxRate = Columns.IncomeTaxRate,
                AddOnProfit = Columns.AddOnProfit,
                SellingValue = Columns.SellingValue,
            };

            if (HeaderAliases.Count == 0 || HeaderRow <= 0) return resolved;

            // Rule 1: heading text of the row, scanned once.
            var headings = new Dictionary<int, string>();
            for (int col = 1; col <= AliasScanCols; col++)
            {
                var text = Normalise(wb.GetString(sheet, HeaderRow, col));
                if (text.Length > 0) headings[col] = text;
            }
            if (headings.Count == 0) return resolved;

            // Rule 2: every alias is resolved against the headings FIRST and
            // applied afterwards. Applying them one at a time cannot express a
            // SWAP -- whichever moved first would find the other's column
            // occupied and decline, leaving the layout half corrected, which
            // reads a heading as a data value.
            var found = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var (field, aliases) in HeaderAliases)
            {
                if (!Setters.ContainsKey(field) || aliases == null || aliases.Count == 0) continue;

                var wanted = aliases.Select(Normalise).Where(a => a.Length > 0).ToHashSet();
                if (wanted.Count == 0) continue;

                var hits = headings.Where(h => wanted.Contains(h.Value)).Select(h => h.Key).ToList();
                if (hits.Count == 0) continue;
                // Rule 3: zero or more than one hit leaves the mapped number alone.
                if (hits.Count > 1)
                {
                    notes.Add($"\"{aliases[0]}\" appears in {hits.Count} columns, so column {CurrentColumn(resolved, field)} was kept.");
                    continue;
                }

                found[field] = hits[0];
            }

            // Rule 4: two fields naming one column means the aliases are wrong,
            // not the sheet. Drop both rather than let the later one win.
            foreach (var group in found.GroupBy(f => f.Value).Where(g => g.Count() > 1).ToList())
            {
                notes.Add($"Column {group.Key} matched more than one heading ({string.Join(", ", group.Select(g => g.Key))}), so the mapped columns were kept.");
                foreach (var f in group) found.Remove(f.Key);
            }

            // Rule 5: every relocation names the old and new column.
            foreach (var (field, col) in found)
            {
                var current = CurrentColumn(resolved, field);
                if (current == col) continue;       // already where the layout said

                Setters[field](resolved, col);
                notes.Add($"\"{HeaderAliases[field][0]}\" was read from column {col}" +
                          (current is > 0 ? $" instead of column {current}." : "."));
            }

            // A number left pointing at a column an alias has taken over would
            // read the same cells twice. Worth saying, not worth refusing -- the
            // mapped column may genuinely hold a second copy.
            var duplicated = MappedColumns(resolved, out var byColumn)
                .Where(c => byColumn[c].Count > 1)
                .ToList();
            foreach (var col in duplicated)
                notes.Add($"Column {col} is mapped to more than one field ({string.Join(", ", byColumn[col])}). Check the layout.");

            return resolved;
        }

        private static int? CurrentColumn(GdCostingColumns c, string field) => field.ToLowerInvariant() switch
        {
            "gdnumber" => c.GdNumber,
            "gddate" => c.GdDate,
            "description" => c.Description,
            "quantity" => c.Quantity,
            "unit" => c.Unit,
            "hscode" => c.HsCode,
            "assessedvalue" => c.AssessedValue,
            "customsduty" => c.CustomsDuty,
            "acd" => c.Acd,
            "regulatoryduty" => c.RegulatoryDuty,
            "others" => c.Others,
            "salestaxrate" => c.SalesTaxRate,
            "astrate" => c.AstRate,
            "incometaxrate" => c.IncomeTaxRate,
            "addonprofit" => c.AddOnProfit,
            "sellingvalue" => c.SellingValue,
            _ => null,
        };
    }
}
