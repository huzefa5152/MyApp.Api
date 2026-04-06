using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class MergeFieldRepository : IMergeFieldRepository
    {
        private readonly AppDbContext _context;

        public MergeFieldRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<MergeField>> GetByTemplateTypeAsync(string templateType)
            => await _context.MergeFields
                .Where(mf => mf.TemplateType == templateType)
                .OrderBy(mf => mf.SortOrder)
                .ToListAsync();

        public async Task<List<MergeField>> GetAllAsync()
            => await _context.MergeFields
                .OrderBy(mf => mf.TemplateType)
                .ThenBy(mf => mf.SortOrder)
                .ToListAsync();

        public async Task<MergeField?> GetByIdAsync(int id)
            => await _context.MergeFields.FindAsync(id);

        public async Task<MergeField> CreateAsync(MergeField mergeField)
        {
            _context.MergeFields.Add(mergeField);
            await _context.SaveChangesAsync();
            return mergeField;
        }

        public async Task<MergeField> UpdateAsync(MergeField mergeField)
        {
            _context.MergeFields.Update(mergeField);
            await _context.SaveChangesAsync();
            return mergeField;
        }

        public async Task DeleteAsync(MergeField mergeField)
        {
            _context.MergeFields.Remove(mergeField);
            await _context.SaveChangesAsync();
        }
    }
}
