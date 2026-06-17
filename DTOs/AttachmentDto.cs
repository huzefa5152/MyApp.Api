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

        public string FileName { get; set; } = "";
        public string FileExtension { get; set; } = "";
        public string ContentType { get; set; } = "";
        public long FileSizeBytes { get; set; }

        public int? UploadedByUserId { get; set; }
        public string? UploadedByName { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
