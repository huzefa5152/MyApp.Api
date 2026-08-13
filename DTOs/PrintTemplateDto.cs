namespace MyApp.Api.DTOs
{
    public class PrintTemplateDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        // Scope: null = company-level; non-null = scoped to this division.
        public int? DivisionId { get; set; }
        // Division name for display (null for company-level templates).
        public string? DivisionName { get; set; }
        public string TemplateType { get; set; } = "";
        // Operator-facing template name within its (company, division, type) scope.
        public string Name { get; set; } = "";
        // Whether this is the default template for its scope (used for printing).
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

        // Assigned company stamp, null when the template prints unsigned.
        public int? StampId { get; set; }
        // The assigned stamp's slug, so the frontend can resolve {{stamp}} to a
        // URL from the stamp list it already holds — no extra fetch per template.
        public string? StampSlug { get; set; }
        // slotted | pinned | none — see Helpers/StampSlot. Drives whether the
        // picker is live, offers "convert to slot", or offers "add signature
        // block". Computed server-side so the list view can show it without
        // shipping template HTML.
        public string StampState { get; set; } = "none";

        public DateTime UpdatedAt { get; set; }
    }

    public class UpsertPrintTemplateDto
    {
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
    }

    // Create a new template in a (company, division?, type) scope.
    public class CreatePrintTemplateDto
    {
        public string TemplateType { get; set; } = "";
        // null = company-level scope; non-null must belong to the route company.
        public int? DivisionId { get; set; }
        public string Name { get; set; } = "";
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
        // Request this template be the scope default. Ignored (forced true) when it
        // is the first template created in the scope.
        public bool IsDefault { get; set; }
        // Carried by "copy template" and by starter-apply so the new template
        // starts with the same signature as its source. Validated against the
        // target company — a stamp from another tenant is rejected.
        public int? StampId { get; set; }
    }

    // Update an existing template's name + body (scope/default unchanged).
    public class UpdatePrintTemplateDto
    {
        public string Name { get; set; } = "";
        public string HtmlContent { get; set; } = "";
        public string? TemplateJson { get; set; }
        public string? EditorMode { get; set; }
    }

    // Assign / clear the stamp on a template. Normally HTML is untouched — the
    // whole point of the slot model is that swapping a signature is a field
    // write, not a template edit.
    //
    // HtmlContent is optional and used only by the two flows that must change
    // markup and assignment together, atomically: converting a pinned
    // {{stamps.<slug>}} reference into a {{stamp}} slot, and injecting a
    // signature block into a template that had none.
    public class SetTemplateStampDto
    {
        public int? StampId { get; set; }
        public string? HtmlContent { get; set; }
    }
}
