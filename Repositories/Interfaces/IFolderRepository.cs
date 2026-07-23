using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IFolderRepository
    {
        Task<List<Folder>> GetByCompanyAsync(int companyId);
        Task<(List<Folder> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize, string? search = null);
        /// <summary>Lightweight load (no attachments) — used for access checks + rename.</summary>
        Task<Folder?> GetByIdAsync(int id);
        /// <summary>Folder + its creator (no attachments — those load via the reconciling AttachmentService).</summary>
        Task<Folder?> GetByIdWithCreatorAsync(int id);
        Task<bool> NameExistsAsync(int companyId, string name, int? excludeId = null);
        Task<Folder> AddAsync(Folder folder);
        Task<Folder> UpdateAsync(Folder folder);
        Task DeleteAsync(Folder folder);
    }
}
