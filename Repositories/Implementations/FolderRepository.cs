using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class FolderRepository : IFolderRepository
    {
        private readonly AppDbContext _context;

        public FolderRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<Folder>> GetByCompanyAsync(int companyId)
        {
            return await _context.Folders
                .Where(f => f.CompanyId == companyId)
                .OrderBy(f => f.Name)
                .AsNoTracking()
                .ToListAsync();
        }

        public async Task<(List<Folder> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize, string? search = null)
        {
            var query = _context.Folders.Where(f => f.CompanyId == companyId);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                query = query.Where(f =>
                    f.Name.ToLower().Contains(term) ||
                    (f.Description != null && f.Description.ToLower().Contains(term)));
            }

            var totalCount = await query.CountAsync();
            var items = await query
                .OrderBy(f => f.Name)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .AsNoTracking()
                .ToListAsync();
            return (items, totalCount);
        }

        public async Task<Folder?> GetByIdAsync(int id)
            => await _context.Folders.FirstOrDefaultAsync(f => f.Id == id);

        public async Task<Folder?> GetByIdWithCreatorAsync(int id)
            => await _context.Folders
                .Include(f => f.CreatedByUser)
                .AsNoTracking()
                .FirstOrDefaultAsync(f => f.Id == id);

        public async Task<bool> NameExistsAsync(int companyId, string name, int? excludeId = null)
        {
            var n = name.Trim().ToLower();
            return await _context.Folders.AnyAsync(f =>
                f.CompanyId == companyId &&
                f.Name.ToLower() == n &&
                (!excludeId.HasValue || f.Id != excludeId.Value));
        }

        public async Task<Folder> AddAsync(Folder folder)
        {
            _context.Folders.Add(folder);
            await _context.SaveChangesAsync();
            return folder;
        }

        public async Task<Folder> UpdateAsync(Folder folder)
        {
            _context.Folders.Update(folder);
            await _context.SaveChangesAsync();
            return folder;
        }

        public async Task DeleteAsync(Folder folder)
        {
            _context.Folders.Remove(folder);
            await _context.SaveChangesAsync();
        }
    }
}
