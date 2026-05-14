namespace MyApp.Api.DTOs
{
    public class PrintTemplateDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string TemplateType { get; set; } = "";
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
        public bool HasExcelTemplate { get; set; }
        // Optional sheet-name pin chosen by the operator on upload. Null
        // means "auto-detect by name match or score". Surfaced on the
        // Print Templates page so the operator can see and edit the choice.
        public string? ExcelSheetName { get; set; }
        // Sheet names present in the uploaded Excel template, in workbook
        // order. Drives the picker dropdown on the frontend.
        public List<string>? ExcelSheetNames { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    public class UpsertPrintTemplateDto
    {
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
    }
}
