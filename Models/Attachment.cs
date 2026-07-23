namespace MyApp.Api.Models
{
    /// <summary>
    /// The single, unified uploaded-file record for the whole ERP. One entity
    /// serves two use cases:
    ///   • Document library — grouped under a <see cref="Folder"/> (FolderId set).
    ///   • Transaction attachment — linked to a business document via
    ///     (EntityType, EntityId), e.g. ("SalesQuote", 42).
    /// Both links are optional and independent: an attachment may sit only in a
    /// folder, only on an entity, on both, or (rarely) neither. It is always
    /// tenant-scoped via <see cref="CompanyId"/> — every read/write asserts
    /// company access. (Division-free in master.)
    ///
    /// The bytes live on disk (see <see cref="Helpers.AttachmentStorage"/>),
    /// never in the database. <see cref="StoredFileName"/> is a GUID so the
    /// operator's original filename can't drive a path-traversal or collide.
    /// </summary>
    public class Attachment
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Optional folder grouping. Null = uncategorized.</summary>
        public int? FolderId { get; set; }

        /// <summary>
        /// Optional business-document link. One of <see cref="Helpers.AttachmentEntityTypes"/>
        /// (e.g. "SalesQuote"). Null when the attachment lives only in a folder.
        /// </summary>
        public string? EntityType { get; set; }
        public int? EntityId { get; set; }

        public string FileName { get; set; } = "";        // original display name
        public string StoredFileName { get; set; } = "";   // {guid}{ext} on disk
        public string StoragePath { get; set; } = "";      // relative: {FolderName|Uncategorized}/{guid}{ext}
        public string ContentType { get; set; } = "";
        public string FileExtension { get; set; } = "";
        public long FileSizeBytes { get; set; }

        /// <summary>SHA-256 of the bytes — dedup / integrity (mirrors PoImportArchive).</summary>
        public string? ContentSha256 { get; set; }

        public int? UploadedByUserId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Folder? Folder { get; set; }
        public User? UploadedByUser { get; set; }
    }
}
