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
            if (!string.Equals(ruleSet.Engine, CurrentEngine, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogWarning("Rule-set engine mismatch: format {FormatId} requests '{Engine}', parser implements '{Current}'", format.Id, ruleSet.Engine, CurrentEngine);
                result.Warnings.Add($"Rule-set engine '{ruleSet.Engine}' is not supported by this parser version.");
                return result;
            }

            // Normalise line endings so all downstream regexes see the same text.
            var text = rawText.Replace("\r\n", "\n").Replace("\r", "\n");

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

        private static int ParseQuantity(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return 0;
            s = s.Replace(",", "").Trim();
            // Strip anything after a decimal point — quantity is always whole in our domain
            var dot = s.IndexOf('.');
            if (dot >= 0) s = s[..dot];
            return int.TryParse(s, out var n) && n > 0 ? n : 0;
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

        // ----- rule-set DTOs (match the JSON stored in POFormat.RuleSetJson) -----

        private class POFormatRuleSet
        {
            [JsonPropertyName("version")] public int Version { get; set; } = 1;
            [JsonPropertyName("engine")] public string Engine { get; set; } = "anchored-v1";
            [JsonPropertyName("fields")] public Dictionary<string, FieldRuleDto>? Fields { get; set; }
            [JsonPropertyName("items")] public ItemRuleDto? Items { get; set; }
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
