namespace MyApp.Api.DTOs
{
    /// <summary>Wire shape for a document folder (a per-company container).</summary>
    public class FolderDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";
        public string? Description { get; set; }
        public int? CreatedByUserId { get; set; }
        public string? CreatedByName { get; set; }
        public DateTime CreatedAt { get; set; }

        /// <summary>Number of attachments in this folder (computed).</summary>
        public int AttachmentCount { get; set; }

        /// <summary>Populated only on the detail read; empty on list reads.</summary>
        public List<AttachmentDto> Attachments { get; set; } = new();
    }

    /// <summary>
    /// Create / rename payload. The server only reads Name + Description — every
    /// other field (CompanyId, counts, timestamps) is derived server-side.
    /// </summary>
    public class CreateFolderDto
    {
        public string Name { get; set; } = "";
        public string? Description { get; set; }
    }
}
