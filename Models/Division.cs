namespace MyApp.Api.Models
{
    /// <summary>
    /// A division / department / sub-brand within a company (e.g. "Aliasghar",
    /// "AMS"). A company can have many. Today it's a simple per-company named
    /// list managed from the company setup screen; a future step can tag
    /// documents with a DivisionId for departmental reporting. Names are unique
    /// per company (see AppDbContext index).
    /// </summary>
    public class Division
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
