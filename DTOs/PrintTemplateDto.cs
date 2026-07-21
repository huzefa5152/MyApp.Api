namespace MyApp.Api.DTOs
{
    public class PrintTemplateDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string TemplateType { get; set; } = "";
        // Operator-facing template name within its (company, type) scope.
        public string Name { get; set; } = "";
        // Whether this is the default template for its type (used for printing).
        public bool IsDefault { get; set; }
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

    // Legacy company-level upsert (kept for the single-template editor path).
    public class UpsertPrintTemplateDto
    {
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
    }

    // Create a new template in a (company, type) scope.
    public class CreatePrintTemplateDto
    {
        public string TemplateType { get; set; } = "";
        public string Name { get; set; } = "";
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
        // Request this template be the type default. Ignored (forced true) when it
        // is the first template created for the type.
        public bool IsDefault { get; set; }
    }

    // Update an existing template's name + body (default flag unchanged).
    public class UpdatePrintTemplateDto
    {
        public string Name { get; set; } = "";
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
    }
}
