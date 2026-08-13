namespace MyApp.Api.Models
{
    // A company-level stamp / signature image usable in any print template as a
    // merge field: {{stamps.<Slug>}} resolves to the image URL. Multiple per
    // company. Slug is immutable + unique per company so renaming the Name never
    // breaks templates that already reference the stamp.
    public class CompanyStamp
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        // Operator-facing label (editable).
        public string Name { get; set; } = "";

        // Stable merge-field key, [a-z0-9_], never starts with a digit. Derived
        // from Name at creation and NEVER changed afterwards.
        public string Slug { get; set; } = "";

        // Public server-relative path, e.g. /data/uploads/stamps/company_4/director_sign.png
        // Served by the /data static provider (same class as the company logo).
        public string FilePath { get; set; } = "";

        // Exactly one default per company (filtered unique index). Used where a
        // stamp is needed but no template row exists to carry a StampId — the
        // built-in fallback templates in defaultTemplates.js — and to
        // pre-select a sensible choice in the pickers.
        public bool IsDefault { get; set; }

        public int SortOrder { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
