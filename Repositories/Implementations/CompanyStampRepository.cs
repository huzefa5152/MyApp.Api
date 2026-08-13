using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class CompanyStampRepository : ICompanyStampRepository
    {
        private readonly AppDbContext _ctx;
        public CompanyStampRepository(AppDbContext ctx) => _ctx = ctx;

        public Task<List<CompanyStamp>> GetByCompanyAsync(int companyId) =>
            _ctx.CompanyStamps.AsNoTracking()
                .Where(s => s.CompanyId == companyId)
                .OrderBy(s => s.SortOrder).ThenBy(s => s.Id)
                .ToListAsync();

        // Tracked — callers may update/delete the returned entity.
        public Task<CompanyStamp?> GetByIdAsync(int id) =>
            _ctx.CompanyStamps.FirstOrDefaultAsync(s => s.Id == id);

        public Task<bool> SlugExistsAsync(int companyId, string slug) =>
            _ctx.CompanyStamps.AnyAsync(s => s.CompanyId == companyId && s.Slug == slug);

        public async Task<int> NextSortOrderAsync(int companyId)
        {
            var max = await _ctx.CompanyStamps
                .Where(s => s.CompanyId == companyId)
                .Select(s => (int?)s.SortOrder)
                .MaxAsync();
            return (max ?? 0) + 1;
        }

        public async Task<CompanyStamp> CreateAsync(CompanyStamp stamp)
        {
            _ctx.CompanyStamps.Add(stamp);
            await _ctx.SaveChangesAsync();
            return stamp;
        }

        public Task SaveAsync() => _ctx.SaveChangesAsync();

        public async Task DeleteAsync(CompanyStamp stamp)
        {
            // The FK is NoAction (a SetNull would give SQL Server multiple
            // cascade paths from Company), so the assignments are cleared here.
            // Templates must survive the deletion and simply print unsigned —
            // never be deleted along with the stamp.
            var assigned = await _ctx.PrintTemplates
                .Where(pt => pt.StampId == stamp.Id)
                .ToListAsync();
            foreach (var t in assigned) t.StampId = null;

            _ctx.CompanyStamps.Remove(stamp);
            await _ctx.SaveChangesAsync();
        }

        public async Task SetDefaultAsync(int companyId, int stampId)
        {
            // Filtered unique index allows only one IsDefault row per company, so
            // the previous default must be cleared in the same SaveChanges.
            var stamps = await _ctx.CompanyStamps
                .Where(s => s.CompanyId == companyId)
                .ToListAsync();
            foreach (var s in stamps) s.IsDefault = s.Id == stampId;
            await _ctx.SaveChangesAsync();
        }

        public Task<int> TemplateUsageCountAsync(int stampId) =>
            _ctx.PrintTemplates.CountAsync(pt => pt.StampId == stampId);
    }
}
