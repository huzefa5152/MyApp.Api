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
        Task<List<AttachmentDto>> GetByFolderAsync(int companyId, int folderId);
        /// <summary>Attachments not filed in any folder (the "Uncategorized" bucket), disk-reconciled.</summary>
        Task<List<AttachmentDto>> GetUncategorizedAsync(int companyId);
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
