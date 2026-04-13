namespace MyApp.Api.DTOs
{
    public class ParsedPODto
    {
        public string? PONumber { get; set; }
        public DateTime? PODate { get; set; }
        public List<ParsedPOItemDto> Items { get; set; } = new();
        public List<string> Warnings { get; set; } = new();
        public string? RawText { get; set; }
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
