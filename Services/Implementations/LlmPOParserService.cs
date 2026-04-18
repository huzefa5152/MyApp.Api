using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class LlmPOParserService : ILlmPOParserService
    {
        private readonly HttpClient _http;
        private readonly string? _apiKey;
        private readonly string _model;
        private readonly ILogger<LlmPOParserService> _logger;

        public bool IsConfigured => !string.IsNullOrWhiteSpace(_apiKey);

        public LlmPOParserService(IConfiguration config, IHttpClientFactory httpFactory, ILogger<LlmPOParserService> logger)
        {
            _http = httpFactory.CreateClient("Gemini");
            _http.Timeout = TimeSpan.FromSeconds(30);
            _apiKey = config["Gemini:ApiKey"];
            _model = config["Gemini:Model"] ?? "gemini-2.0-flash";
            _logger = logger;
        }

        public async Task<ParsedPODto?> ParseWithLlmAsync(string rawText)
        {
            if (!IsConfigured) return null;

            // Truncate very long texts to stay within token limits
            if (rawText.Length > 8000)
                rawText = rawText[..8000];

            var prompt = BuildPrompt(rawText);

            try
            {
                var requestBody = new
                {
                    contents = new[]
                    {
                        new
                        {
                            parts = new[]
                            {
                                new { text = prompt }
                            }
                        }
                    },
                    generationConfig = new
                    {
                        temperature = 0.1,
                        maxOutputTokens = 2048,
                        responseMimeType = "application/json"
                    }
                };

                var json = JsonSerializer.Serialize(requestBody);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                var url = $"https://generativelanguage.googleapis.com/v1beta/models/{_model}:generateContent?key={_apiKey}";

                // Retry on 429 (rate limit) once with a short backoff — Gemini free tier is
                // 10 req/min, and a single PDF parse is a one-shot interactive call so it
                // makes sense to wait briefly rather than immediately fall back to the
                // (much weaker) regex parser.
                HttpResponseMessage response;
                for (int attempt = 1; attempt <= 2; attempt++)
                {
                    // Recreate the content on each retry — HttpContent can't be reused
                    var reqContent = new StringContent(json, Encoding.UTF8, "application/json");
                    response = await _http.PostAsync(url, reqContent);

                    if (response.IsSuccessStatusCode)
                    {
                        var responseJson = await response.Content.ReadAsStringAsync();
                        return ParseGeminiResponse(responseJson, rawText);
                    }

                    // Rate limited → wait a few seconds and try once more
                    if ((int)response.StatusCode == 429 && attempt == 1)
                    {
                        _logger.LogInformation("Gemini rate-limited, retrying in 8s…");
                        await Task.Delay(TimeSpan.FromSeconds(8));
                        continue;
                    }

                    var errorBody = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("Gemini API error {Status}: {Body}", response.StatusCode, errorBody);
                    return null;
                }
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gemini API call failed, falling back to regex parser");
                return null;
            }
        }

        private static string BuildPrompt(string rawText)
        {
            return $@"You extract structured data from Purchase Orders (POs) in Pakistan. The
raw text is taken verbatim from a PDF, so table cells may be split across
multiple lines. Return ONLY valid JSON — no explanations, no markdown.

=============== FIELD RULES ===============

po_number (string or null):
  The unique PO / Order identifier. Search for labels like:
    ""PO No"", ""P.O No"", ""P. O. No"", ""P.O. Number"", ""PO #"",
    ""Order No"", ""Purchase Order No"", ""Purchase Order:""
  The value may be purely numeric (e.g. ""21620"", ""260475"", ""262447"")
  OR alphanumeric with prefixes/suffixes (e.g. ""POGI-001-2626-0000505"",
  ""INV-2024-001"", ""PO/GD-12345"").
  DO NOT return generic labels like ""Reference"", ""Control"", ""Print"".
  DO NOT return the supplier's NTN number or the vendor code.
  DO NOT include the label itself (return just the value).

po_date (YYYY-MM-DD or null):
  The PO issue date. NEVER use the print date, delivery date,
  or today's date. Look for labels: ""PO Date"", ""P.O. Date"", ""Order Date"",
  ""Date"" near the PO number. Pakistan format like ""03-FEB-26"",
  ""17/04/2026"", ""2026-04-17"" — convert to YYYY-MM-DD (assume 2026
  for 2-digit years like ""26"").

supplier_name (string or null):
  The vendor / supplier name (i.e. who is being paid). NOT the buyer.
  Often labeled ""Supplier"", ""Supplier Title"", ""Supplier Name"", ""To:"".

items (array):
  Each line item from the order table. One object per physical product
  line. Be smart about multi-line cells:

  CRITICAL: PDF tables often print one column per line, so a single item
  may span 4–8 text lines. The product description + its spec notes
  ALL belong in ""description"" — join them with spaces.
  Example — this block describes ONE item:
     SOLENOID COIL 220VAC
     6.0VA
     10.00
     Piece
     400.000
     4,000.00
     COIL FOR SOLENOID
     VALVE, AC220V,6.0.V,
     VOLT RANGE AC 187V-
     253V, 100%ED,IP65
  → description: ""SOLENOID COIL 220VAC 6.0VA - COIL FOR SOLENOID VALVE, AC220V,6.0.V, VOLT RANGE AC 187V-253V, 100%ED,IP65""
  → quantity: 10
  → unit: ""Piece""

  description: The product name + any spec/model notes, joined with spaces
    or commas. PRESERVE the text — do not summarize or translate. Include
    model numbers, voltages, sizes. Typical length 20–200 characters.

  quantity: Must be a positive integer. Strip decimals and commas
    (e.g. ""10.00"" → 10, ""1,250"" → 1250). If quantity is zero or
    missing, skip the item entirely.

  unit: A SHORT unit of measure — 1–15 characters, ALPHABETIC.
    Allowed examples: ""Pcs"", ""PC"", ""Piece"", ""NOS"", ""KG"", ""Meter"",
    ""Liter"", ""Bag"", ""Coil"", ""Roll"", ""Pair"", ""Set"".
    DO NOT put model numbers, voltages, or part codes here (""638M-"",
    ""P-Max Pc"", ""24N2a Pc"", ""10Bar Pc"" are WRONG — those belong in
    description). If the unit looks suspicious, default to ""Pcs"".

IGNORE these sections entirely:
  - Totals, subtotals, grand totals, tax rows
  - Terms & conditions, payment terms, legal notes
  - Header/footer boilerplate, address blocks
  - Signature blocks, printed-by, prepared-by
  - ""Amount in words"" lines

If a field is not found, return null. For items, return [] if none.

=============== OUTPUT FORMAT ===============
{{
  ""po_number"": ""string or null"",
  ""po_date"": ""YYYY-MM-DD or null"",
  ""supplier_name"": ""string or null"",
  ""items"": [
    {{ ""description"": ""string"", ""quantity"": 0, ""unit"": ""string"" }}
  ]
}}

=============== RAW PO TEXT ===============
{rawText}";
        }

        private ParsedPODto? ParseGeminiResponse(string responseJson, string rawText)
        {
            try
            {
                using var doc = JsonDocument.Parse(responseJson);
                var root = doc.RootElement;

                // Navigate: candidates[0].content.parts[0].text
                var candidates = root.GetProperty("candidates");
                if (candidates.GetArrayLength() == 0) return null;

                var text = candidates[0]
                    .GetProperty("content")
                    .GetProperty("parts")[0]
                    .GetProperty("text")
                    .GetString();

                if (string.IsNullOrWhiteSpace(text)) return null;

                // Clean markdown code fences if present
                text = text.Trim();
                if (text.StartsWith("```json")) text = text[7..];
                if (text.StartsWith("```")) text = text[3..];
                if (text.EndsWith("```")) text = text[..^3];
                text = text.Trim();

                var parsed = JsonSerializer.Deserialize<LlmParsedPO>(text, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true,
                    // Gemini 2.5 likes to emit "quantity": 10.00 as a decimal even when we
                    // ask for int. Accept that (and also accept strings like "10") without
                    // failing the whole parse.
                    NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString
                                   | System.Text.Json.Serialization.JsonNumberHandling.AllowNamedFloatingPointLiterals
                });

                if (parsed == null) return null;

                var result = new ParsedPODto
                {
                    RawText = rawText,
                    PONumber = parsed.PoNumber,
                    Warnings = new List<string>()
                };

                // Parse date
                if (!string.IsNullOrWhiteSpace(parsed.PoDate) &&
                    DateTime.TryParse(parsed.PoDate, out var date))
                {
                    result.PODate = date;
                }

                // Map items — also sanitize the "unit" field since Gemini sometimes
                // leaks model numbers / specs into it (e.g. "638M- Pc", "10Bar Pc").
                if (parsed.Items != null)
                {
                    foreach (var item in parsed.Items)
                    {
                        if (!string.IsNullOrWhiteSpace(item.Description) && item.Quantity > 0)
                        {
                            var (cleanUnit, unitNoise) = SanitizeUnit(item.Unit);
                            // If we extracted noise from the unit field, prepend it to the
                            // description so we don't lose useful part-number info.
                            var desc = item.Description.Trim();
                            if (!string.IsNullOrWhiteSpace(unitNoise) &&
                                !desc.Contains(unitNoise, StringComparison.OrdinalIgnoreCase))
                            {
                                desc = $"{desc} {unitNoise}".Trim();
                            }
                            result.Items.Add(new ParsedPOItemDto
                            {
                                Description = desc,
                                Quantity = item.Quantity,
                                Unit = cleanUnit
                            });
                        }
                    }
                }

                // Add supplier info as a warning/info if found
                if (!string.IsNullOrWhiteSpace(parsed.SupplierName))
                    result.Warnings.Add($"Supplier: {parsed.SupplierName}");

                if (string.IsNullOrEmpty(result.PONumber))
                    result.Warnings.Add("Could not detect PO Number. Please enter it manually.");
                if (result.PODate == null)
                    result.Warnings.Add("Could not detect PO Date. Please enter it manually.");
                if (result.Items.Count == 0)
                    result.Warnings.Add("Could not detect any items. Please add items manually.");

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to parse Gemini response");
                return null;
            }
        }

        // A real UOM is 1–15 chars, alphabetic, doesn't contain digits or
        // most punctuation. Known units also count. Anything else is noise
        // (part numbers, specs) and we downgrade the unit to "Pcs".
        private static readonly HashSet<string> KnownUnits = new(StringComparer.OrdinalIgnoreCase)
        {
            "Pc", "Pcs", "Piece", "Pieces", "NOS", "NO", "Unit", "Units", "Each",
            "KG", "Kilogram", "Gram", "G", "MT", "Ton", "Tonne",
            "Meter", "M", "CM", "MM", "Foot", "Feet", "Inch", "Inches",
            "Liter", "Litre", "L", "Gallon", "Barrel",
            "Bag", "Box", "Carton", "Drum", "Roll", "Coil", "Set", "Pair",
            "Bottle", "Can", "Pack", "Packet", "Dozen", "Sheet", "Bundle",
            "SqM", "SqFt", "CBM", "SqY",
        };

        private static (string clean, string noise) SanitizeUnit(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return ("Pcs", "");
            var t = raw.Trim();
            // Easy path — already a known unit
            if (KnownUnits.Contains(t)) return (t, "");

            // Split on whitespace — often Gemini concatenates the real unit with
            // a part-number token like "638M- Pc" → noise="638M-", unit="Pc"
            var tokens = t.Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (tokens.Length > 1)
            {
                var knownToken = tokens.FirstOrDefault(tok => KnownUnits.Contains(tok));
                if (knownToken != null)
                {
                    var noise = string.Join(" ", tokens.Where(tok => tok != knownToken));
                    return (knownToken, noise.Trim());
                }
            }

            // Looks alphabetic and short? trust it
            if (t.Length <= 15 && t.All(c => char.IsLetter(c) || c == ' ' || c == ','))
                return (t, "");

            // Contains digits or part-number characters — it's not a real unit.
            // Preserve the original text as "noise" so callers can put it back
            // into the description, and default unit to Pcs.
            return ("Pcs", t);
        }

        private class LlmParsedPO
        {
            [JsonPropertyName("po_number")]
            public string? PoNumber { get; set; }

            [JsonPropertyName("po_date")]
            public string? PoDate { get; set; }

            [JsonPropertyName("supplier_name")]
            public string? SupplierName { get; set; }

            [JsonPropertyName("items")]
            public List<LlmParsedItem>? Items { get; set; }
        }

        private class LlmParsedItem
        {
            [JsonPropertyName("description")]
            public string Description { get; set; } = "";

            // Store as decimal and convert to int when needed — Gemini 2.5 often
            // emits fractional-looking numbers like 10.00 even when we ask for int.
            [JsonPropertyName("quantity")]
            public decimal QuantityDecimal { get; set; }

            [JsonIgnore]
            public int Quantity => (int)Math.Round(QuantityDecimal, MidpointRounding.AwayFromZero);

            [JsonPropertyName("unit")]
            public string Unit { get; set; } = "";
        }
    }
}
