namespace MyApp.Api.Models
{
    public class PrintTemplate
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string TemplateType { get; set; } = ""; // Challan, Bill, TaxInvoice
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
        public string? ExcelTemplatePath { get; set; }
        // Operator-chosen sheet name on the Excel template. The reverse mapper
        // auto-picks the first sheet with placeholders, but when import files
        // are multi-sheet (e.g. ship with a leading "Settings" tab), the
        // operator can pin this to the data sheet's name so the importer
        // resolves to the right index every time. Null = auto-detect.
        public string? ExcelSheetName { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
