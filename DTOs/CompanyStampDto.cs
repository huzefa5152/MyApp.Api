namespace MyApp.Api.DTOs
{
    public class CompanyStampDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string Slug { get; set; } = "";
        // Server-relative image URL, e.g. /data/uploads/stamps/company_1/director_sign.png
        public string Url { get; set; } = "";
        public int SortOrder { get; set; }
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
