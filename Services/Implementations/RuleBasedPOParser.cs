using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    // Deterministic, data-driven parser. Takes a POFormat (whose RuleSetJson
    // was authored once during onboarding) + the raw PO text, and returns a
    // ParsedPODto without ever calling an LLM.
    //
    // The rule-set schema is versioned by an "engine" field so we can ship a
    // v2 engine later without corrupting v1 rules (the parser ignores rule-sets
    // whose engine doesn't match what it understands).
    public class RuleBasedPOParser : IRuleBasedPOParser
    {
        private const string CurrentEngine = "anchored-v1";
        private const string SimpleEngine = "simple-headers-v1";
        private readonly ILogger<RuleBasedPOParser> _logger;

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
            NumberHandling = JsonNumberHandling.AllowReadingFromString,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true,
        };

        public RuleBasedPOParser(ILogger<RuleBasedPOParser> logger)
        {
            _logger = logger;
        }

        public ParsedPODto Parse(string rawText, POFormat format)
        {
            var result = new ParsedPODto { RawText = rawText, Warnings = new List<string>() };
            if (string.IsNullOrWhiteSpace(rawText)) return result;

            POFormatRuleSet? ruleSet;
            try
            {
                ruleSet = JsonSerializer.Deserialize<POFormatRuleSet>(format.RuleSetJson, JsonOpts);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Rule-set JSON for format {FormatId} ({Name}) is malformed", format.Id, format.Name);
                result.Warnings.Add($"Rule-set for format '{format.Name}' is malformed — falling back to LLM/regex.");
                return result;
            }
            if (ruleSet == null) return result;

            // Normalise line endings so all downstream regexes see the same text.
            var text = rawText.Replace("\r\n", "\n").Replace("\r", "\n");

            // Simple onboarding mode: operator gave us 5 strings, we parse
            // the PDF directly off those without hand-crafted regex.
            if (string.Equals(ruleSet.Engine, SimpleEngine, StringComparison.OrdinalIgnoreCase))
            {
                return ParseSimpleHeaders(text, ruleSet, format, result);
            }

            if (!string.Equals(ruleSet.Engine, CurrentEngine, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Rule-set engine mismatch: format {FormatId} requests '{Engine}', parser implements '{Current}'", format.Id, ruleSet.Engine, CurrentEngine);
                result.Warnings.Add($"Rule-set engine '{ruleSet.Engine}' is not supported by this parser version.");
                return result;
            }

            // --- fields ---
            if (ruleSet.Fields != null)
            {
                if (ruleSet.Fields.TryGetValue("poNumber", out var f))
                    result.PONumber = ApplyFieldRule(text, f);
                if (ruleSet.Fields.TryGetValue("poDate", out var fd))
                {
                    var dateStr = ApplyFieldRule(text, fd);
                    if (!string.IsNullOrWhiteSpace(dateStr))
                        result.PODate = ParseDate(dateStr, fd.DateFormats);
                }
                if (ruleSet.Fields.TryGetValue("supplier", out var fs))
                {
                    var supplier = ApplyFieldRule(text, fs);
                    if (!string.IsNullOrWhiteSpace(supplier))
                        result.Warnings.Add($"Supplier: {supplier.Trim()}");
                }
            }

            // --- items ---
            if (ruleSet.Items != null)
            {
                try
                {
                    result.Items = ExtractItems(text, ruleSet.Items);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Item extraction failed for format {FormatId}", format.Id);
                    result.Warnings.Add("Item extraction failed — please review the PO manually.");
                }
            }

            // --- validation warnings, matching the shape other parsers produce ---
            if (string.IsNullOrEmpty(result.PONumber))
                result.Warnings.Add("Could not detect PO Number. Please enter it manually.");
            if (result.PODate == null)
                result.Warnings.Add("Could not detect PO Date. Please enter it manually.");
            if (result.Items.Count == 0)
                result.Warnings.Add("Could not detect any items. Please add items manually.");

            return result;
        }

        // ----- helpers -----

        private static string? ApplyFieldRule(string text, FieldRuleDto? rule)
        {
            if (rule == null || string.IsNullOrWhiteSpace(rule.Regex)) return null;
            var m = Regex.Match(text, rule.Regex, ParseFlags(rule.Flags));
            if (!m.Success) return null;
            var group = Math.Max(0, rule.Group);
            if (group >= m.Groups.Count) return null;
            var val = m.Groups[group].Value?.Trim();
            return string.IsNullOrWhiteSpace(val) ? null : val;
        }

        private static RegexOptions ParseFlags(string? flags)
        {
            if (string.IsNullOrWhiteSpace(flags)) return RegexOptions.None;
            var opts = RegexOptions.None;
            foreach (var c in flags)
            {
                switch (char.ToLowerInvariant(c))
                {
                    case 'i': opts |= RegexOptions.IgnoreCase; break;
                    case 'm': opts |= RegexOptions.Multiline; break;
                    case 's': opts |= RegexOptions.Singleline; break;
                    case 'x': opts |= RegexOptions.IgnorePatternWhitespace; break;
                }
            }
            return opts;
        }

        private static DateTime? ParseDate(string input, string[]? formats)
        {
            input = input.Trim().TrimEnd('.', ',');
            var defaultFormats = new[]
            {
                "dd-MMM-yy", "dd-MMM-yyyy", "d-MMM-yy", "d-MMM-yyyy",
                "dd/MM/yyyy", "dd/MM/yy", "MM/dd/yyyy", "yyyy-MM-dd",
                "dd-MM-yyyy", "d/M/yyyy",
            };
            var tryFormats = (formats != null && formats.Length > 0)
                ? formats.Concat(defaultFormats).Distinct().ToArray()
                : defaultFormats;

            if (DateTime.TryParseExact(input, tryFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out var exact))
            {
                if (exact.Year < 100) exact = exact.AddYears(2000);
                if (exact.Year >= 2000 && exact.Year <= 2099) return exact;
            }

            if (DateTime.TryParse(input, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out var loose))
            {
                if (loose.Year >= 2000 && loose.Year <= 2099) return loose;
            }
            return null;
        }

        private static List<ParsedPOItemDto> ExtractItems(string text, ItemRuleDto rule)
        {
            var strategy = (rule.Strategy ?? "column-split").ToLowerInvariant();
            return strategy switch
            {
                "column-split" => ExtractItemsColumnSplit(text, rule),
                "row-regex" => ExtractItemsRowRegex(text, rule),
                _ => new List<ParsedPOItemDto>(),
            };
        }

        // Splits each line by a configurable separator (typically `\s{2,}`,
        // since the PdfPig dumper inserts 2+ spaces at column boundaries).
        // Data rows are the ones that match `rowFilter`; anything between a
        // data row and the next data row (or the stop regex) is treated as a
        // continuation and appended to the previous item's description.
        private static List<ParsedPOItemDto> ExtractItemsColumnSplit(string text, ItemRuleDto rule)
        {
            var items = new List<ParsedPOItemDto>();
            var splitPattern = rule.Split?.Regex ?? @"\s{2,}";
            var splitOpts = ParseFlags(rule.Split?.Flags);

            var rowFilterRegex = rule.RowFilter != null
                ? new Regex(rule.RowFilter.Regex, ParseFlags(rule.RowFilter.Flags))
                : null;
            var stopRegex = rule.StopRegex != null
                ? new Regex(rule.StopRegex.Regex, ParseFlags(rule.StopRegex.Flags))
                : null;
            var descStrip = !string.IsNullOrWhiteSpace(rule.DescStripRegex)
                ? new Regex(rule.DescStripRegex!)
                : null;

            var lines = text.Split('\n');
            ParsedPOItemDto? current = null;

            foreach (var rawLine in lines)
            {
                var line = rawLine.TrimEnd();
                if (string.IsNullOrWhiteSpace(line)) continue;

                // Per-page chrome — skip without treating as a stop or as a
                // description continuation. Makes multi-page POs work: the
                // footer of page 1 ("Page No :1 of 3", "Printed By", etc.)
                // no longer ends the scan before pages 2+ items are seen.
                if (PageChromeRegex.IsMatch(line)) continue;

                if (stopRegex != null && stopRegex.IsMatch(line))
                {
                    if (current != null) { items.Add(current); current = null; }
                    break;
                }

                var isDataRow = rowFilterRegex == null || rowFilterRegex.IsMatch(line);

                if (isDataRow)
                {
                    if (current != null) items.Add(current);

                    var cols = Regex.Split(line, splitPattern, splitOpts)
                                    .Select(s => s.Trim())
                                    .Where(s => s.Length > 0)
                                    .ToArray();

                    var desc = BuildDescription(cols, rule, descStrip);
                    var qty = ParseQuantity(GetColumn(cols, rule.QtyColumn));
                    var unit = GetColumn(cols, rule.UnitColumn);

                    if (string.IsNullOrWhiteSpace(desc) || qty <= 0)
                    {
                        current = null;
                        continue;
                    }

                    current = new ParsedPOItemDto
                    {
                        Description = desc,
                        Quantity = qty,
                        Unit = NormaliseUnit(unit),
                    };
                }
                else if (current != null && (rule.ContinuationJoin ?? true))
                {
                    // Continuation line — append to previous item's description.
                    // Strip stray brackets/punctuation so the description doesn't
                    // end up with "( " or ") " from multi-line table wrapping.
                    var clean = Regex.Replace(line.Trim(), @"^[\(\)\s,]+|[\(\)\s,]+$", "").Trim();
                    if (clean.Length > 0)
                        current.Description = $"{current.Description} {clean}".Trim();
                }
            }

            if (current != null) items.Add(current);
            return items.Where(i => !string.IsNullOrWhiteSpace(i.Description) && i.Quantity > 0).ToList();
        }

        private static List<ParsedPOItemDto> ExtractItemsRowRegex(string text, ItemRuleDto rule)
        {
            var items = new List<ParsedPOItemDto>();
            if (rule.Row?.Regex == null) return items;

            var rowRegex = new Regex(rule.Row.Regex, ParseFlags(rule.Row.Flags));
            var stopRegex = rule.StopRegex != null
                ? new Regex(rule.StopRegex.Regex, ParseFlags(rule.StopRegex.Flags))
                : null;

            var lines = text.Split('\n');
            ParsedPOItemDto? current = null;

            foreach (var raw in lines)
            {
                var line = raw.TrimEnd();
                if (string.IsNullOrWhiteSpace(line)) continue;

                // Per-page chrome — skip without stopping or appending.
                // Keeps multi-page POs parsing past page 1's footer.
                if (PageChromeRegex.IsMatch(line)) continue;

                if (stopRegex != null && stopRegex.IsMatch(line))
                {
                    if (current != null) { items.Add(current); current = null; }
                    break;
                }

                var m = rowRegex.Match(line);
                if (m.Success)
                {
                    if (current != null) items.Add(current);

                    var desc = GetGroup(m, rule.DescGroup) ?? "";
                    var qty = ParseQuantity(GetGroup(m, rule.QtyGroup));
                    var unit = GetGroup(m, rule.UnitGroup) ?? "";

                    if (string.IsNullOrWhiteSpace(desc) || qty <= 0)
                    {
                        current = null;
                        continue;
                    }

                    current = new ParsedPOItemDto
                    {
                        Description = desc.Trim(),
                        Quantity = qty,
                        Unit = NormaliseUnit(unit),
                    };
                }
                else if (current != null && (rule.ContinuationJoin ?? true))
                {
                    var clean = Regex.Replace(line.Trim(), @"^[\(\)\s,]+|[\(\)\s,]+$", "").Trim();
                    if (clean.Length > 0)
                        current.Description = $"{current.Description} {clean}".Trim();
                }
            }

            if (current != null) items.Add(current);
            return items.Where(i => !string.IsNullOrWhiteSpace(i.Description) && i.Quantity > 0).ToList();
        }

        private static string BuildDescription(string[] cols, ItemRuleDto rule, Regex? strip)
        {
            string desc;
            if (rule.DescColumns != null && rule.DescColumns.Length > 0)
            {
                desc = string.Join(" ", rule.DescColumns
                    .Select(ci => GetColumn(cols, ci))
                    .Where(s => !string.IsNullOrWhiteSpace(s)));
            }
            else
            {
                desc = GetColumn(cols, rule.DescColumn) ?? "";
            }

            if (strip != null)
                desc = strip.Replace(desc, "", 1);

            return desc.Trim();
        }

        private static string GetColumn(string[] cols, int? idx)
        {
            if (idx == null || idx < 0 || idx >= cols.Length) return "";
            return cols[idx.Value] ?? "";
        }

        private static string? GetGroup(Match m, string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            if (int.TryParse(name, out var n))
                return n < m.Groups.Count ? m.Groups[n].Value : null;
            var g = m.Groups[name];
            return g?.Success == true ? g.Value : null;
        }

        private static decimal ParseQuantity(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0m;
            s = s.Replace(",", "").Trim();
            // Decimal quantity — fractional UOMs (KG, Liter, Carat) need to
            // round-trip "12.5" or "0.0004" through the parser intact.
            // Validation downstream rejects fractional values for UOMs whose
            // AllowsDecimalQuantity flag is off, so we don't have to know
            // the unit here.
            return decimal.TryParse(s, System.Globalization.NumberStyles.Number,
                                       System.Globalization.CultureInfo.InvariantCulture,
                                       out var n) && n > 0 ? n : 0m;
        }

        // Map common unit strings to the canonical forms we persist elsewhere.
        // If the raw token isn't a known unit we keep it as-is (title-cased) so
        // the correction UI still shows the PDF's wording instead of a guess.
        private static string NormaliseUnit(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return "Pcs";
            var t = raw.Trim().TrimEnd('.').ToLowerInvariant();
            return t switch
            {
                "pc" or "pcs" or "piece" or "pieces" => "Pcs",
                "no" or "nos" or "number" or "numbers" => "Nos",
                "kg" or "kgs" or "kilogram" or "kilograms" => "Kg",
                "set" or "sets" => "Set",
                "meter" or "meters" or "mtr" or "mtrs" or "m" => "Mtr",
                "ltr" or "ltrs" or "liter" or "liters" or "litre" or "litres" => "Ltr",
                "bag" or "bags" => "Bags",
                "roll" or "rolls" => "Rolls",
                "coil" or "coils" => "Coil",
                "pair" or "pairs" => "Pairs",
                "box" or "boxes" => "Box",
                "each" or "ea" => "Each",
                "ton" or "tons" => "Ton",
                "unit" or "units" => "Unit",
                "dozen" or "dzn" => "Dozen",
                "bundle" or "bundles" => "Bundle",
                _ => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(t),
            };
        }

        // ==============================================================
        //  simple-headers-v1 engine
        // --------------------------------------------------------------
        //  Onboarding-friendly mode. The operator provides five strings
        //  (PO-number label, PO-date label, description/qty/unit column
        //  headers) and the parser locates everything at runtime. No
        //  hand-crafted regex is required per client.
        //
        //  Behaviour:
        //  - poNumber: find the label line, return the next whitespace-
        //    separated token (alphanumeric + dashes/slashes).
        //  - poDate: find the label line, return the first date-pattern
        //    token that follows (dd/MM/yyyy, dd-MMM-yy, etc.).
        //  - items: locate the line that contains all three column
        //    headers as whole words. That becomes the table header.
        //    Subsequent lines are candidate data rows; we stop at the
        //    first known totals/terms marker. Each row is scanned for
        //    a decimal/whole-number quantity followed by a short alpha
        //    unit — everything before that is treated as the description
        //    (with leading S.No / Item-Id prefix dropped). Lines that
        //    don't fit the pattern are appended as continuations to the
        //    previous row's description.
        // ==============================================================
        // Real end-of-items markers. Hitting one of these means the item
        // table is actually over — flush current and break. Keep this list
        // tight: only things that appear ONCE, after all items are listed.
        // (Earlier this list also included "Terms", "Page No", "Printed By"
        // etc. which appear on every page's footer — that caused multi-page
        // POs to stop parsing at the bottom of page 1.)
        private static readonly Regex SimpleStopRegex = new(
            // Footer markers — once any of these appear we know the items
            // table has ended. Three Meko-specific markers were missing
            // (`Total <amount>` on its own line, `Sales Tax Amount`, and
            // `ET Amount`), which let footer text leak into the last
            // item's description on Meko-format POs (e.g. "CUTTING DISK
            // 4\" RODIUS Total 7,200 Sales Tax Amount 1,296 ET Amount 0").
            // The new alternatives are tight enough to skip Lotte/Soorty
            // data rows, which always start with a numeric S.No instead.
            @"^\s*(In\s+words|Amount\s+in\s+Words|Sub-?\s*Total|Sales\s+Tax\s*@|Sales\s+Tax\s+Amount|ET\s+Amount|Excise\s+Duty|Grand\s+Total|Payable\s+Amount|Discount\s+Amount|Total\s+Amount|Total\s+[\d,]+(?:\.\d+)?\s*$|Freight\s*/?\s*Cartage|Remarks\s*:|For\s+Meko|HEAD\s+OFFICE|Email:|Rupees\s+Only)\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Per-page chrome: header/footer lines that REPEAT on every page of
        // a multi-page PO. These are skipped (continue) rather than treated
        // as stops, so the parser keeps scanning into pages 2, 3, ... after
        // page 1's footer and finds the remaining items. Covers all saved
        // formats — on continuation pages we only care about description,
        // quantity, unit.
        //
        // Matched either at the start of a line OR anywhere in the line
        // (some chrome markers come in the middle of wrapped lines, e.g.
        // "22-APR-26 10:37:56 AM  registered person must issue Sales T").
        // No trailing word-boundary — many markers end in `#` or `:` which
        // are non-word characters and would break a trailing `\b`.
        private static readonly Regex PageChromeRegex = new(
            @"(^\s*|\s)(Print\s+Date|Printed\s+By|Prepared\s+By|Special\s+Instructions|U\s*/\s*S\s+\d+\s+of\s+Sales\s+Tax|registered\s+person|It'?s\s+a\s+Product\s+of|\d+\s*\)\s+(Payment|Supplier|Documents|Lotte|Freight|Goods|Delivery|Shelf)|Terms\s*:|SCM\s*-|Purchase\s+Order\s+for|Documents\s+Required|Page\s+No|Page\s+\d+\s+of\s+\d+|Supplier\s+Name|Supplier\s+Address|Address\s*:|Location\s*:|P\.?O\.?\s*Date|P\.?O\.?\s*#|P\.?R\.?\s*#|Pur\.?\s*Req\.?|Purchase\s+Req|N\.?T\.?N\.?\s*No|G\.?S\.?T\.?\s*No|Phone\s*#|Fax\s*#|LOTTE\s+Kolson|MEKO\s+DENIM|SOORTY|Noman\s+Aslam|L-\d+\s*,\s*Block|F\.B\.?\s*Industrial|Rs\.\s*$|Item\s+Name\s*$|Item\s+Id|Unit\s+Price|Total\s+Price|Required\s+Delivery\s+Date|Payment\s+Terms|Delivery\s+Terms|Delivery\s+Location|Non-Inventory\s+Items|Dispensary\s*:)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Standalone timestamp / page-printed-on stamp like
        // "22-APR-26 10:37:56 AM" that appears only in footers — never in
        // an item row.
        private static readonly Regex PageStampRegex = new(
            @"\b\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?\b",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Row value-pair, qty-then-unit direction (description  …  QTY  UNIT  rate…).
        // Quantity can be decimal or comma-grouped; unit must be 1-12 letters.
        private static readonly Regex SimpleQtyThenUnitRegex = new(
            @"(?<qty>[\d,]+(?:\.\d+)?)\s+(?<unit>[A-Za-z]{1,12})\b",
            RegexOptions.Compiled);

        // Row value-pair, unit-then-qty direction (description  …  UNIT  QTY  rate…).
        // Same shape, reversed. Used when the header line puts Unit before Quantity.
        private static readonly Regex SimpleUnitThenQtyRegex = new(
            @"\b(?<unit>[A-Za-z]{1,12})\s+(?<qty>[\d,]+(?:\.\d+)?)\b",
            RegexOptions.Compiled);

        // Generic date token — dd/MM/yyyy, dd-MMM-yy etc. Used to locate
        // the PO date after its label.
        private static readonly Regex SimpleDateRegex = new(
            @"\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}-[A-Za-z]{3}-\d{2,4})\b",
            RegexOptions.Compiled);

        private ParsedPODto ParseSimpleHeaders(string text, POFormatRuleSet ruleSet, POFormat format, ParsedPODto result)
        {
            var poNumLabel = ruleSet.PoNumberLabel ?? "";
            var poDateLabel = ruleSet.PoDateLabel ?? "";
            var descHdr = ruleSet.DescriptionHeader ?? "";
            var qtyHdr = ruleSet.QuantityHeader ?? "";
            var unitHdr = ruleSet.UnitHeader ?? "";

            var lines = text.Split('\n');

            // --- PO number ---
            if (!string.IsNullOrWhiteSpace(poNumLabel))
            {
                // After the label, optionally skip a leading document-class
                // prefix so the captured PO number is the digit-led business
                // identifier the user enters on bills and challans. We accept
                // two prefix shapes:
                //   - "[A-Za-z]+-"        — dash-suffixed (e.g. Lotte's POGI-)
                //   - "[A-Za-z]{1,3}\s+"  — short alpha + whitespace (e.g.
                //     Meko's "S 260714"). Capped at 3 letters so we don't
                //     swallow a meaningful alpha portion of a real PO number.
                // Both prefix shapes are optional — pure-numeric PO numbers
                // (or "2026/001") are captured unchanged.
                var labelPattern = @"(?i)" + Regex.Escape(poNumLabel) + @"\s*[:#]?\s*(?:[A-Za-z]+-|[A-Za-z]{1,3}\s+)?(\d[A-Za-z0-9\-/.]*)";
                var m = Regex.Match(text, labelPattern);
                if (m.Success)
                {
                    result.PONumber = m.Groups[1].Value.Trim();
                }
                else
                {
                    // Fallback: token starts with alpha (client without the
                    // document-class prefix pattern). Capture whatever follows.
                    var fallback = @"(?i)" + Regex.Escape(poNumLabel) + @"\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-/.]*)";
                    var m2 = Regex.Match(text, fallback);
                    if (m2.Success) result.PONumber = m2.Groups[1].Value.Trim();
                }
            }

            // --- PO date ---
            if (!string.IsNullOrWhiteSpace(poDateLabel))
            {
                var idx = text.IndexOf(poDateLabel, StringComparison.OrdinalIgnoreCase);
                if (idx >= 0)
                {
                    var tail = text[(idx + poDateLabel.Length)..];
                    var m = SimpleDateRegex.Match(tail);
                    if (m.Success) result.PODate = ParseDate(m.Groups[1].Value, null);
                }
            }

            // --- items ---
            if (!string.IsNullOrWhiteSpace(descHdr) &&
                !string.IsNullOrWhiteSpace(qtyHdr) &&
                !string.IsNullOrWhiteSpace(unitHdr))
            {
                result.Items = ExtractSimpleItems(lines, descHdr, qtyHdr, unitHdr);
            }

            if (string.IsNullOrEmpty(result.PONumber))
                result.Warnings.Add("Could not detect PO Number. Please enter it manually.");
            if (result.PODate == null)
                result.Warnings.Add("Could not detect PO Date. Please enter it manually.");
            if (result.Items.Count == 0)
                result.Warnings.Add("Could not detect any items. Please add items manually.");

            return result;
        }

        private static List<ParsedPOItemDto> ExtractSimpleItems(string[] lines, string descHdr, string qtyHdr, string unitHdr)
        {
            var items = new List<ParsedPOItemDto>();

            // Find the header line — the first line that contains all three
            // headers as whole-word matches (case-insensitive) — and determine
            // whether Quantity comes before Unit or after it (column order
            // varies between clients: Lotte is qty-then-unit, Meko is
            // unit-then-qty). We read the data rows with the matching
            // regex direction.
            int headerIdx = -1;
            bool unitBeforeQty = false;
            for (int i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                if (ContainsWord(line, descHdr) && ContainsWord(line, qtyHdr) && ContainsWord(line, unitHdr))
                {
                    headerIdx = i;
                    var qtyPos = line.IndexOf(qtyHdr, StringComparison.OrdinalIgnoreCase);
                    var unitPos = line.IndexOf(unitHdr, StringComparison.OrdinalIgnoreCase);
                    unitBeforeQty = unitPos >= 0 && qtyPos >= 0 && unitPos < qtyPos;
                    break;
                }
            }
            if (headerIdx < 0) return items;

            var pairRegex = unitBeforeQty ? SimpleUnitThenQtyRegex : SimpleQtyThenUnitRegex;
            ParsedPOItemDto? current = null;

            for (int i = headerIdx + 1; i < lines.Length; i++)
            {
                var line = lines[i].TrimEnd();
                if (string.IsNullOrWhiteSpace(line)) continue;

                // Skip secondary header fragments that wrap onto a second line
                // (common in our PDFs: "Unit Price" / "Delivery Date"). A line
                // whose tokens are mostly alphabetic and contain no numerics
                // IMMEDIATELY after the real header row is almost always a header
                // continuation — not a data row.
                //
                // Tightened from `i <= headerIdx + 2` to `i == headerIdx + 1`
                // because the wider window also swallowed legitimate item
                // wrap-lines that happen to be a single alpha word (e.g.
                // Meko PO has "G.I NUT BOLT 16X160MM W/DOUBLE" on the data
                // row and "WASHER" on the wrap row — the wrap row sits at
                // headerIdx+2 and was being silently dropped).
                if (i == headerIdx + 1 && !line.Any(char.IsDigit) && line.Trim().Split(' ').All(t => t.All(char.IsLetter) || t.Length <= 2))
                    continue;

                // Per-page chrome (repeating page header/footer across multi-
                // page POs). We FLUSH `current` here before skipping — any
                // legitimate multi-line continuation for the last item would
                // have already arrived before the chrome intervenes, so
                // nothing on or after this line belongs to `current`.
                // Prevents stray wrap-lines like "Karachi" or "Unit - 2"
                // from leaking into the previous item's description when
                // they sit between the page 1 footer and page 2 items.
                if (PageChromeRegex.IsMatch(line))
                {
                    if (current != null) { items.Add(current); current = null; }
                    continue;
                }

                // Standalone timestamp line from the page footer, e.g.
                // "22-APR-26 10:37:56 AM".
                if (PageStampRegex.IsMatch(line) && !Regex.IsMatch(line, @"\b[A-Za-z]{3,}\b.*\d+\.\d+"))
                {
                    if (current != null) { items.Add(current); current = null; }
                    continue;
                }

                // Repeated column header on page 2+ — a line that holds all
                // three configured headers as whole words. Skip silently.
                if (ContainsWord(line, descHdr) && ContainsWord(line, qtyHdr) && ContainsWord(line, unitHdr))
                {
                    if (current != null) { items.Add(current); current = null; }
                    continue;
                }

                if (SimpleStopRegex.IsMatch(line))
                {
                    if (current != null) { items.Add(current); current = null; }
                    break;
                }

                // Find the qty/unit pair in the direction the header dictated.
                // qty-first (Lotte, Soorty): prefer decimal qty pairs since
                // item IDs like "008790 Mounting" look like integer-qty+alpha-
                // unit pairs; fall back to integer pairs only when no decimal
                // pair exists.
                // unit-first (Meko): take the first valid alpha+int pair
                // — the "qty" column is almost always an integer here.
                var candidates = pairRegex.Matches(line);
                Match? picked = null;

                // True when the line begins with a real S.No / Item Id
                // leader. Continuation lines from wrapped descriptions
                // never have one, so we use this to gate ALL THREE pick
                // passes (first/second/third) — otherwise units that ARE
                // technically real UOMs but commonly appear inside
                // descriptions ("Mm" in cable cross-sections, "Cm" in
                // sheet sizes, "M" in pipe diameters) get picked from
                // continuation text and produce phantom items.
                bool lineHasRowLeader = HasLeadingRowMarker(line);

                // First pass: a pair whose unit is a RECOGNISED UOM
                // (NOS, Piece, KG, PC, etc.). Iterates in REVERSE — the
                // real qty/unit column lives near the RIGHT end of the
                // line, while pairs earlier in the line are almost always
                // inside descriptions (e.g. "Oil Paint (3.64 Ltr)").
                // Also rejects pairs immediately preceded by "(" — those
                // are in-description specs, not columns. Now also gated on
                // `lineHasRowLeader` so continuation lines (which never
                // start with the S.No / Item Id leader) cannot be picked.
                var orderedDesc = candidates.Cast<Match>().Reverse().ToList();
                if (lineHasRowLeader)
                {
                    foreach (Match m in orderedDesc)
                    {
                        var qtyRaw = m.Groups["qty"].Value;
                        var unit = m.Groups["unit"].Value;
                        if (IsNonUnitToken(unit)) continue;
                        // Reject absurdly large qty tokens. Use the NUMERIC value
                        // rather than character length so "10.00" (5 chars) still
                        // passes while "004539" (item ID, len 6, value 4539) is
                        // rejected by being > 9999.
                        if (IsImplausibleQty(qtyRaw)) continue;
                        if (!unitBeforeQty && m.Index == 0) continue;
                        if (IsInsideParens(line, m.Index)) continue;
                        if (!IsRecognisedUnit(unit)) continue;
                        picked = m;
                        break;
                    }
                }
                // Second pass (qty-first mode only): any decimal qty pair,
                // even with an unknown unit. Decimals almost always indicate
                // a real qty column.
                if (picked == null && !unitBeforeQty && lineHasRowLeader)
                {
                    foreach (Match m in candidates)
                    {
                        var qtyRaw = m.Groups["qty"].Value;
                        var unit = m.Groups["unit"].Value;
                        if (IsNonUnitToken(unit)) continue;
                        if (!qtyRaw.Contains('.')) continue;
                        picked = m;
                        break;
                    }
                }
                // Last resort: integer pair with a short alpha unit.
                if (picked == null && lineHasRowLeader)
                {
                    foreach (Match m in candidates)
                    {
                        var qtyRaw = m.Groups["qty"].Value;
                        var unit = m.Groups["unit"].Value;
                        if (IsNonUnitToken(unit)) continue;
                        if (IsImplausibleQty(qtyRaw)) continue;
                        if (!unitBeforeQty && m.Index == 0) continue;
                        picked = m;
                        break;
                    }
                }

                if (picked != null)
                {
                    // Description = everything on this line before the qty
                    // token, minus the leading S.No + Item-Id prefix and
                    // any trailing delivery-date / timestamp column that
                    // sat between description and qty in the source layout.
                    var prefix = line[..picked.Index].TrimEnd();
                    var desc = SanitiseDescription(StripRowLeader(prefix));

                    var qty = ParseQuantity(picked.Groups["qty"].Value);
                    var unit = picked.Groups["unit"].Value;

                    if (string.IsNullOrWhiteSpace(desc) || qty <= 0)
                    {
                        // Not a real data row — probably a subtotal or footnote.
                        continue;
                    }

                    if (current != null) items.Add(current);
                    current = new ParsedPOItemDto
                    {
                        Description = desc,
                        Quantity = qty,
                        Unit = NormaliseUnit(unit),
                    };
                }
                else if (current != null)
                {
                    var clean = Regex.Replace(line.Trim(), @"^[\(\)\s,]+|[\(\)\s,]+$", "").Trim();
                    clean = SanitiseDescription(clean);
                    if (clean.Length > 0)
                        current.Description = $"{current.Description} {clean}".Trim();
                }
            }

            if (current != null) items.Add(current);
            return items.Where(x => !string.IsNullOrWhiteSpace(x.Description) && x.Quantity > 0).ToList();
        }

        // Strip leading date / page-chrome fragments and trailing date/
        // timestamp columns from a description string. The PDF table has
        // the Required Delivery Date column between description and qty —
        // we don't want that date ending up on the item description.
        private static readonly Regex DateTokenRegex = new(
            @"\b\d{1,2}[-\/][A-Za-z]{3}[-\/]\d{2,4}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b",
            RegexOptions.Compiled);

        private static string SanitiseDescription(string desc)
        {
            if (string.IsNullOrWhiteSpace(desc)) return "";
            // Strip repeating page-chrome fragments (Phone #, Address:,
            // Terms :, Page No, timestamps, etc.) that may have been
            // concatenated onto the real description text.
            desc = PageChromeRegex.Replace(desc, " ");
            desc = PageStampRegex.Replace(desc, " ");
            desc = DateTokenRegex.Replace(desc, " ");
            // Collapse multiple spaces, strip edge punctuation noise.
            desc = Regex.Replace(desc, @"\s{2,}", " ").Trim();
            desc = Regex.Replace(desc, @"^[\(\)\s,\.\-:;]+|[\(\)\s,\.\-:;]+$", "").Trim();
            return desc;
        }

        // True when a numeric qty candidate is clearly too large to be a
        // real order quantity in this domain (> 9999) — typically an item
        // ID or part number that got paired with a description word.
        private static bool IsImplausibleQty(string qtyRaw)
        {
            if (string.IsNullOrWhiteSpace(qtyRaw)) return true;
            var s = qtyRaw.Replace(",", "").Trim();
            var dot = s.IndexOf('.');
            if (dot >= 0) s = s[..dot];
            if (!int.TryParse(s, out var n)) return true;
            return n > 9999;
        }

        private static bool ContainsWord(string haystack, string needle)
        {
            if (string.IsNullOrWhiteSpace(haystack) || string.IsNullOrWhiteSpace(needle)) return false;
            var pattern = $@"(^|\W){Regex.Escape(needle)}(\W|$)";
            return Regex.IsMatch(haystack, pattern, RegexOptions.IgnoreCase);
        }

        // True when the line begins with the kind of leader a real data
        // row carries — at least one numeric token (the S.No) followed
        // by whitespace, optionally followed by a second numeric token
        // (the Item Id) and more text. Used to gate the LENIENT passes
        // in ExtractSimpleItems so that wrap-line continuations (which
        // start with description text, not numbers) don't get misread
        // as standalone items.
        //
        // Patterns this matches:
        //   "1  003651  Cable Flexible ..."   (Lotte: S.No + Item Id)
        //   "10020041 CUTTING DISK 4\" RODIUS" (Meko: Item Id only)
        //   "1 0 (076-006530-01) ..."          (Soorty: S.No + parens)
        //
        // Patterns this rejects (continuation lines):
        //   ", 300/500 Volt Rating."           (Lotte wrap)
        //   "Core 2.5 Mm² , 300/500..."        (Lotte wrap)
        //   "Mm² , 300/500 Volt Rating."       (Lotte wrap)
        //   "( G-ELECTRICAL ITEMS 6.0VA"       (Soorty wrap)
        private static readonly Regex RowLeaderRegex = new(
            @"^\s*\d+(\s+\d+)?\s+\S",
            RegexOptions.Compiled);

        private static bool HasLeadingRowMarker(string line)
            => RowLeaderRegex.IsMatch(line ?? "");

        // Tokens that look alphabetic but are clearly not a UOM. Prevents
        // "Rs. 7,500.00" from being parsed as qty=7,500.00 unit="Rs" etc.
        private static readonly HashSet<string> NonUnitTokens = new(StringComparer.OrdinalIgnoreCase)
        {
            "Rs", "PKR", "USD", "AM", "PM", "Price", "Total", "Amount", "Date",
            "Only", "Tax", "Duty", "Discount", "Freight", "Cartage", "Sub", "ST",
            "ET", "Payable", "Grand",
        };

        private static bool IsNonUnitToken(string token) =>
            string.IsNullOrWhiteSpace(token) || NonUnitTokens.Contains(token);

        // Real units of measure — if a pair's unit token is in this set we
        // have high confidence it's the qty/unit column. Everything else is
        // considered ambiguous (probably from inside a description).
        private static readonly HashSet<string> RecognisedUnits = new(StringComparer.OrdinalIgnoreCase)
        {
            "Pc", "Pcs", "Piece", "Pieces", "NOS", "NO", "Unit", "Units", "Each", "Ea",
            "KG", "Kg", "Kgs", "Kilogram", "Kilograms", "Gram", "Grams", "G", "MT", "Ton", "Tons", "Tonne", "Tonnes",
            "Meter", "Meters", "Mtr", "Mtrs", "M", "CM", "Cm", "MM", "Mm", "Foot", "Feet", "Ft", "Inch", "Inches", "In",
            "Liter", "Liters", "Litre", "Litres", "Ltr", "Ltrs", "L", "Gallon", "Gallons", "Barrel", "Barrels",
            "Bag", "Bags", "Box", "Boxes", "Carton", "Cartons", "Drum", "Drums", "Roll", "Rolls", "Coil", "Coils",
            "Set", "Sets", "Pair", "Pairs", "Bottle", "Bottles", "Can", "Cans", "Pack", "Packs", "Packet", "Packets",
            "Dozen", "Dozens", "Dzn", "Sheet", "Sheets", "Bundle", "Bundles",
            "SqM", "SqFt", "CBM", "SqY",
        };

        private static bool IsRecognisedUnit(string token) =>
            !string.IsNullOrWhiteSpace(token) && RecognisedUnits.Contains(token);

        // True if position `idx` in `line` sits inside a (…) group. Used to
        // reject in-description specs like "Oil Paint (3.64 Ltr)" which
        // otherwise look like a qty/unit pair to the regex.
        private static bool IsInsideParens(string line, int idx)
        {
            int opens = 0;
            for (int i = 0; i < idx && i < line.Length; i++)
            {
                if (line[i] == '(') opens++;
                else if (line[i] == ')' && opens > 0) opens--;
            }
            return opens > 0;
        }

        // Strip the leading "S.No + Item Id" pattern ("1 008790") or
        // ("33100102") from the start of a row so the description reads
        // cleanly. We only strip up to two leading numeric tokens.
        private static string StripRowLeader(string line)
        {
            var trimmed = line.TrimStart();
            var m = Regex.Match(trimmed, @"^\d+(\s+\d+)?\s+");
            if (m.Success) trimmed = trimmed[m.Length..];
            return trimmed.Trim();
        }

        // ----- rule-set DTOs (match the JSON stored in POFormat.RuleSetJson) -----

        private class POFormatRuleSet
        {
            [JsonPropertyName("version")] public int Version { get; set; } = 1;
            [JsonPropertyName("engine")] public string Engine { get; set; } = "anchored-v1";
            [JsonPropertyName("fields")] public Dictionary<string, FieldRuleDto>? Fields { get; set; }
            [JsonPropertyName("items")] public ItemRuleDto? Items { get; set; }

            // simple-headers-v1 inputs
            [JsonPropertyName("poNumberLabel")] public string? PoNumberLabel { get; set; }
            [JsonPropertyName("poDateLabel")]   public string? PoDateLabel { get; set; }
            [JsonPropertyName("descriptionHeader")] public string? DescriptionHeader { get; set; }
            [JsonPropertyName("quantityHeader")]    public string? QuantityHeader { get; set; }
            [JsonPropertyName("unitHeader")]        public string? UnitHeader { get; set; }
        }

        private class FieldRuleDto
        {
            [JsonPropertyName("regex")] public string Regex { get; set; } = "";
            [JsonPropertyName("group")] public int Group { get; set; } = 1;
            [JsonPropertyName("flags")] public string? Flags { get; set; }
            [JsonPropertyName("dateFormats")] public string[]? DateFormats { get; set; }
        }

        private class ItemRuleDto
        {
            [JsonPropertyName("strategy")] public string? Strategy { get; set; }
            [JsonPropertyName("split")] public FieldRuleDto? Split { get; set; }
            [JsonPropertyName("rowFilter")] public FieldRuleDto? RowFilter { get; set; }
            [JsonPropertyName("stopRegex")] public FieldRuleDto? StopRegex { get; set; }
            [JsonPropertyName("descColumns")] public int[]? DescColumns { get; set; }
            [JsonPropertyName("descColumn")] public int? DescColumn { get; set; }
            [JsonPropertyName("descStripRegex")] public string? DescStripRegex { get; set; }
            [JsonPropertyName("qtyColumn")] public int? QtyColumn { get; set; }
            [JsonPropertyName("unitColumn")] public int? UnitColumn { get; set; }
            [JsonPropertyName("continuationJoin")] public bool? ContinuationJoin { get; set; }

            [JsonPropertyName("row")] public FieldRuleDto? Row { get; set; }
            [JsonPropertyName("descGroup")] public string? DescGroup { get; set; }
            [JsonPropertyName("qtyGroup")] public string? QtyGroup { get; set; }
            [JsonPropertyName("unitGroup")] public string? UnitGroup { get; set; }
        }
    }
}
