namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for an uploaded file. The bytes are NOT included — the client
    /// fetches them via the authenticated download endpoint. The internal
    /// on-disk <c>StoragePath</c> is deliberately omitted from the wire shape.
    /// </summary>
    public class AttachmentDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int? FolderId { get; set; }
        public string? FolderName { get; set; }
        public string? EntityType { get; set; }
        public int? EntityId { get; set; }

        /// <summary>
        /// The linked document's display number (e.g. "12"), resolved server-side
        /// for folder / uncategorized listings. Null for direct uploads (no entity).
        /// </summary>
        public string? EntityNumber { get; set; }

        /// <summary>
        /// Friendly source label: "Direct upload", or the document kind
        /// ("Sales Quote", "Credit Note", "Receipt", …). Populated only where the
        /// source matters (folder / uncategorized listings); null otherwise.
        /// </summary>
        public string? SourceLabel { get; set; }

        public string FileName { get; set; } = "";
        public string FileExtension { get; set; } = "";
        public string ContentType { get; set; } = "";
        public long FileSizeBytes { get; set; }

        public int? UploadedByUserId { get; set; }
        public string? UploadedByName { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
