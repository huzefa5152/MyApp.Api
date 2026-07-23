namespace MyApp.Api.Models
{
    /// <summary>
    /// A named, per-company container for documents. Part of the unified
    /// attachment system: a folder groups <see cref="Attachment"/> rows under a
    /// human-friendly name in the Configuration → Navigation Menu document library.
    ///
    /// Tenant-scoped — every folder belongs to a <see cref="Company"/> and folder
    /// names are unique within a company (see the (CompanyId, Name) unique index
    /// in AppDbContext). Folders are flat: no nesting, matching the spec's flat
    /// listing.
    /// </summary>
    public class Folder
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? Description { get; set; }

        /// <summary>Operator who created the folder. Nullable for tooling / seed rows.</summary>
        public int? CreatedByUserId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public User? CreatedByUser { get; set; }
        public ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();
    }
}
