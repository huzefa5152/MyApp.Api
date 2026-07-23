using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IAttachmentService
    {
        /// <summary>
        /// Validates + stores an uploaded file and persists its Attachment row.
        /// folderId / (entityType, entityId) are both optional and validated:
        /// the folder must belong to <paramref name="companyId"/>, and the
        /// entity type must be one of <see cref="Helpers.AttachmentEntityTypes"/>.
        /// </summary>
        Task<AttachmentDto> UploadAsync(int companyId, IFormFile file, int? folderId, string? entityType, int? entityId, int userId);

        /// <summary>
        /// Folder listing, disk-reconciled, with source (EntityNumber/SourceLabel)
        /// populated. <paramref name="source"/> optionally filters by origin:
        /// null/""/"All" = everything, "Direct" = folder-only uploads, or a
        /// canonical entity type (e.g. "SalesQuote"). Invalid values fall back to All.
        /// </summary>
        Task<List<AttachmentDto>> GetByFolderAsync(int companyId, int folderId, string? source = null);
        /// <summary>Uncategorized bucket (FolderId == null), disk-reconciled + source-populated + filtered.</summary>
        Task<List<AttachmentDto>> GetUncategorizedAsync(int companyId, string? source = null);
        /// <summary>Source key → count for a folder's filter chips ("Direct", "SalesQuote", …); only non-zero keys.</summary>
        Task<Dictionary<string, int>> GetFolderSourceSummaryAsync(int companyId, int folderId);
        /// <summary>Source key → count for the Uncategorized bucket's filter chips; only non-zero keys.</summary>
        Task<Dictionary<string, int>> GetUncategorizedSourceSummaryAsync(int companyId);
        Task<List<AttachmentDto>> GetByEntityAsync(int companyId, string entityType, int entityId);
        /// <summary>entityId → attachment count (disk-reconciled), for list-card badges (e.g. Sales Quote list).</summary>
        Task<Dictionary<int, int>> GetCountsByEntityAsync(int companyId, string entityType, IEnumerable<int> entityIds);
        /// <summary>folderId → attachment count (disk-reconciled), for the Folders list badges.</summary>
        Task<Dictionary<int, int>> GetCountsByFolderAsync(int companyId, IEnumerable<int> folderIds);
        /// <summary>Metadata only — the controller asserts company access on the returned CompanyId.</summary>
        Task<AttachmentDto?> GetByIdAsync(int id);
        /// <summary>Resolved file path + content type for streaming; null when the row or file is missing.</summary>
        Task<AttachmentDownload?> GetForDownloadAsync(int id);
        Task<bool> DeleteAsync(int id);
    }

    /// <summary>Everything the controller needs to stream a download (after asserting access).</summary>
    public record AttachmentDownload(int CompanyId, string AbsolutePath, string ContentType, string FileName);
}
