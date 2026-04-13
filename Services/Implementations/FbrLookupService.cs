using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class FbrLookupService : IFbrLookupService
    {
        private readonly AppDbContext _context;

        public FbrLookupService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<FbrLookup>> GetAllAsync()
        {
            return await _context.FbrLookups
                .Where(l => l.IsActive)
                .OrderBy(l => l.Category)
                .ThenBy(l => l.SortOrder)
                .ToListAsync();
        }

        public async Task<List<FbrLookup>> GetByCategoryAsync(string category)
        {
            return await _context.FbrLookups
                .Where(l => l.Category == category && l.IsActive)
                .OrderBy(l => l.SortOrder)
                .ToListAsync();
        }

        public async Task<FbrLookup> CreateAsync(FbrLookup lookup)
        {
            _context.FbrLookups.Add(lookup);
            await _context.SaveChangesAsync();
            return lookup;
        }

        public async Task<FbrLookup?> UpdateAsync(int id, FbrLookup lookup)
        {
            var existing = await _context.FbrLookups.FindAsync(id);
            if (existing == null) return null;

            existing.Category = lookup.Category;
            existing.Code = lookup.Code;
            existing.Label = lookup.Label;
            existing.SortOrder = lookup.SortOrder;
            existing.IsActive = lookup.IsActive;

            await _context.SaveChangesAsync();
            return existing;
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var existing = await _context.FbrLookups.FindAsync(id);
            if (existing == null) return false;

            _context.FbrLookups.Remove(existing);
            await _context.SaveChangesAsync();
            return true;
        }
    }
}
