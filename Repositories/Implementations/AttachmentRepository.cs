using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class AttachmentRepository : IAttachmentRepository
    {
        private readonly AppDbContext _context;

        public AttachmentRepository(AppDbContext context)
        {
            _context = context;
        }

        private IQueryable<Attachment> WithIncludes() =>
            _context.Attachments
                .Include(a => a.Folder)
                .Include(a => a.UploadedByUser);

        public async Task<List<Attachment>> GetByFolderAsync(int companyId, int folderId)
            => await WithIncludes()
                .Where(a => a.CompanyId == companyId && a.FolderId == folderId)
                .OrderByDescending(a => a.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

        public async Task<List<Attachment>> GetUncategorizedAsync(int companyId)
            => await WithIncludes()
                .Where(a => a.CompanyId == companyId && a.FolderId == null)
                .OrderByDescending(a => a.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

        public async Task<List<Attachment>> GetByEntityAsync(int companyId, string entityType, int entityId)
            => await WithIncludes()
                .Where(a => a.CompanyId == companyId && a.EntityType == entityType && a.EntityId == entityId)
                .OrderByDescending(a => a.CreatedAt)
                .AsNoTracking()
                .ToListAsync();

        public async Task<List<Attachment>> GetByEntityIdsAsync(int companyId, string entityType, IEnumerable<int> entityIds)
        {
            var ids = entityIds.Distinct().ToList();
            if (ids.Count == 0) return new List<Attachment>();
            return await _context.Attachments
                .Where(a => a.CompanyId == companyId && a.EntityType == entityType
                            && a.EntityId != null && ids.Contains(a.EntityId.Value))
                .AsNoTracking()
                .ToListAsync();
        }

        public async Task<List<Attachment>> GetByFolderIdsAsync(int companyId, IEnumerable<int> folderIds)
        {
            var ids = folderIds.Distinct().ToList();
            if (ids.Count == 0) return new List<Attachment>();
            return await _context.Attachments
                .Where(a => a.CompanyId == companyId && a.FolderId != null && ids.Contains(a.FolderId.Value))
                .AsNoTracking()
                .ToListAsync();
        }

        // Tracked (no AsNoTracking) so the same load can back a delete.
        public async Task<Attachment?> GetByIdAsync(int id)
            => await WithIncludes().FirstOrDefaultAsync(a => a.Id == id);

        public async Task<Attachment> AddAsync(Attachment attachment)
        {
            _context.Attachments.Add(attachment);
            await _context.SaveChangesAsync();
            return attachment;
        }

        public async Task DeleteAsync(Attachment attachment)
        {
            _context.Attachments.Remove(attachment);
            await _context.SaveChangesAsync();
        }

        public async Task DeleteByIdsAsync(IEnumerable<int> ids)
        {
            var list = ids.Distinct().ToList();
            if (list.Count == 0) return;
            await _context.Attachments.Where(a => list.Contains(a.Id)).ExecuteDeleteAsync();
        }
    }
}
