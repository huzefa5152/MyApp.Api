namespace MyApp.Api.Models
{
    public class PrintTemplate
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        // Scope: null = company-level template (applies when no division is in play);
        // non-null = scoped to a specific division within the company. A company with
        // no divisions only ever has company-level (null) templates.
        public int? DivisionId { get; set; }

        public string TemplateType { get; set; } = ""; // Challan, Bill, TaxInvoice, SalesQuote, SalesOrder

        // Operator-facing name distinguishing multiple templates of the same type
        // within one scope (e.g. "Default", "Modern Letterhead").
        public string Name { get; set; } = "Default";

        // Exactly one template per (CompanyId, DivisionId, TemplateType) is the default.
        // Enforced by a filtered unique index in AppDbContext. The default is what the
        // print/export paths resolve to (company-level default for now — documents are
        // not yet tagged with a division).
        public bool IsDefault { get; set; } = true;

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
        public Division? Division { get; set; }
    }
}
