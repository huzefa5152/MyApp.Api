namespace MyApp.Api.DTOs
{
    public class ParsedPODto
    {
        public string? PONumber { get; set; }
        public DateTime? PODate { get; set; }
        public List<ParsedPOItemDto> Items { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
        public string? RawText { get; set; }

        // When the deterministic rule-based parser routed this text to a
        // known POFormat, we surface the id/name/version so the UI can
        // display a badge and offer "save as verified sample" without
        // parsing our warning strings.
        public int? MatchedFormatId { get; set; }
        public string? MatchedFormatName { get; set; }
        public int? MatchedFormatVersion { get; set; }

        // The client that the matched POFormat was authored for. Surfacing
        // this lets the import review screen pre-select the client instead
        // of making the operator re-pick it on every import.
        public int? MatchedClientId { get; set; }
        public string? MatchedClientName { get; set; }
    }

    public class ParsedPOItemDto
    {
        public string Description { get; set; } = "";
        public int Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    public class ParseTextRequest
    {
        public string Text { get; set; } = "";
    }
}
