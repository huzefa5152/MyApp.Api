using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IAttachmentRepository
    {
        Task<List<Attachment>> GetByFolderAsync(int companyId, int folderId);
        /// <summary>Attachments not filed in any folder (FolderId == null) — the "Uncategorized" bucket.</summary>
        Task<List<Attachment>> GetUncategorizedAsync(int companyId);
        Task<List<Attachment>> GetByEntityAsync(int companyId, string entityType, int entityId);
        /// <summary>Load attachments for many entity ids (batch counts + disk reconcile).</summary>
        Task<List<Attachment>> GetByEntityIdsAsync(int companyId, string entityType, IEnumerable<int> entityIds);
        /// <summary>Load attachments for many folder ids (badge counts + disk reconcile).</summary>
        Task<List<Attachment>> GetByFolderIdsAsync(int companyId, IEnumerable<int> folderIds);
        /// <summary>Loads one attachment (with Folder + uploader) for download / delete / detail.</summary>
        Task<Attachment?> GetByIdAsync(int id);
        Task<Attachment> AddAsync(Attachment attachment);
        Task DeleteAsync(Attachment attachment);
        /// <summary>Bulk-delete orphan rows whose files were removed from disk.</summary>
        Task DeleteByIdsAsync(IEnumerable<int> ids);
    }
}
