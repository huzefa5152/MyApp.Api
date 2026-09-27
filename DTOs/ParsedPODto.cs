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
        // Decimal so PO parsers can carry "12.5 KG" through unchanged.
        public decimal Quantity { get; set; }
        public string Unit { get; set; } = "";
    }

    public class ParseTextRequest
    {
        public string Text { get; set; } = "";
    }

    /// <summary>
    /// One word the browser's OCR read, in image pixels (Y grows downward).
    /// The server, not the browser, turns words into lines
    /// (<c>Helpers.PoLayoutText.FromOcrPage</c>), so an image is laid out by the
    /// same rule as a PDF and matches the same saved PO format.
    /// </summary>
    public class OcrWordDto
    {
        public string Text { get; set; } = "";
        public double Left { get; set; }
        public double Right { get; set; }
        public double Top { get; set; }
        public double Bottom { get; set; }
        /// <summary>0-100, as tesseract reports it.</summary>
        public double Confidence { get; set; }
    }

    public class OcrPagesDto
    {
        public List<List<OcrWordDto>> Pages { get; set; } = new();
    }
}
