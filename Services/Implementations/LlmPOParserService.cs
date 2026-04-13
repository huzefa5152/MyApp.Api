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
                var response = await _http.PostAsync(url, content);

                if (!response.IsSuccessStatusCode)
                {
                    var errorBody = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("Gemini API error {Status}: {Body}", response.StatusCode, errorBody);
                    return null;
                }

                var responseJson = await response.Content.ReadAsStringAsync();
                return ParseGeminiResponse(responseJson, rawText);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gemini API call failed, falling back to regex parser");
                return null;
            }
        }

        private static string BuildPrompt(string rawText)
        {
            return $@"You are a Purchase Order (PO) parser. Extract structured data from the raw text below.

RULES:
- Only extract if reasonably confident. Do not guess.
- po_number: Look for ""PO No"", ""P.O No"", ""P. O. No"", ""Order No"", ""PO #"", ""Purchase Order:"" labels. Return the value, not the label.
- po_date: The date associated with the PO (not print date, not delivery date). Format as YYYY-MM-DD.
- supplier_name: The vendor/supplier company name.
- items: Array of line items from the order table. Each must have description, quantity (integer), and unit.
- Ignore totals, taxes, terms, addresses, and legal text.
- If a field is not found, return null for that field.
- For items array, return empty array [] if no items found.
- Preserve item descriptions exactly as written in the PO.

Return ONLY valid JSON in this exact format:
{{
  ""po_number"": ""string or null"",
  ""po_date"": ""YYYY-MM-DD or null"",
  ""supplier_name"": ""string or null"",
  ""items"": [
    {{
      ""description"": ""string"",
      ""quantity"": 0,
      ""unit"": ""string""
    }}
  ]
}}

RAW PO TEXT:
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
                    PropertyNameCaseInsensitive = true
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

                // Map items
                if (parsed.Items != null)
                {
                    foreach (var item in parsed.Items)
                    {
                        if (!string.IsNullOrWhiteSpace(item.Description) && item.Quantity > 0)
                        {
                            result.Items.Add(new ParsedPOItemDto
                            {
                                Description = item.Description.Trim(),
                                Quantity = item.Quantity,
                                Unit = string.IsNullOrWhiteSpace(item.Unit) ? "Pcs" : item.Unit.Trim()
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

            [JsonPropertyName("quantity")]
            public int Quantity { get; set; }

            [JsonPropertyName("unit")]
            public string Unit { get; set; } = "";
        }
    }
}
