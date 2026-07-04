using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IFolderService
    {
        /// <summary>Full list for the company (used by the attachment-component dropdown).</summary>
        Task<List<FolderDto>> GetByCompanyAsync(int companyId);
        Task<PagedResult<FolderDto>> GetPagedByCompanyAsync(int companyId, int page, int pageSize, string? search = null);
        /// <summary>Folder detail including its attachments. When
        /// <paramref name="userIdForDivisionScope"/> is supplied, the embedded
        /// attachment list is filtered to that user's accessible divisions
        /// (company-level attachments always included — policy D1).</summary>
        Task<FolderDto?> GetByIdAsync(int id, int? userIdForDivisionScope = null);
        Task<FolderDto> CreateAsync(int companyId, CreateFolderDto dto, int userId);
        Task<FolderDto?> UpdateAsync(int id, CreateFolderDto dto);
        /// <summary>
        /// Deletes a folder. Entity-linked attachments are un-categorized
        /// (FolderId set null, file kept); folder-only attachments and their
        /// files are removed. All in one transaction; files deleted post-commit.
        /// </summary>
        Task<bool> DeleteAsync(int id);
    }
}
