namespace MyApp.Api.DTOs
{
    public class CompanyStampDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string Slug { get; set; } = "";
        // Server-relative image URL, e.g. /data/uploads/stamps/company_4/director_sign.png
        public string Url { get; set; } = "";
        // The company's default stamp — pre-selected in the pickers and used by
        // the built-in fallback templates, which have no row to carry a StampId.
        public bool IsDefault { get; set; }
        public int SortOrder { get; set; }
        // How many print templates render this stamp. Populated on the list
        // endpoint so the delete confirmation can say what will stop being signed.
        public int UsedByTemplates { get; set; }
        public DateTime UpdatedAt { get; set; }
    }

    // Rename / reorder only — the image and slug are immutable after upload
    // (re-upload by deleting and adding a new stamp).
    public class UpdateCompanyStampDto
    {
        public string? Name { get; set; }
        public int? SortOrder { get; set; }
    }
}
