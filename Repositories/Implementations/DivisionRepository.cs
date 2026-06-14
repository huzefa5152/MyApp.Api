using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class DivisionRepository : IDivisionRepository
    {
        private readonly AppDbContext _context;

        public DivisionRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<Division>> GetByCompanyAsync(int companyId) =>
            await _context.Divisions
                .Where(d => d.CompanyId == companyId)
                .OrderBy(d => d.Name)
                .AsNoTracking()
                .ToListAsync();

        public async Task<Division?> GetByIdAsync(int id) =>
            await _context.Divisions.FirstOrDefaultAsync(d => d.Id == id);

        public async Task<Division> AddAsync(Division division)
        {
            _context.Divisions.Add(division);
            await _context.SaveChangesAsync();
            return division;
        }

        public async Task<Division> UpdateAsync(Division division)
        {
            _context.Divisions.Update(division);
            await _context.SaveChangesAsync();
            return division;
        }

        public async Task DeleteAsync(Division division)
        {
            _context.Divisions.Remove(division);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> ExistsByNameAsync(int companyId, string name, int? excludeId = null) =>
            await _context.Divisions.AnyAsync(d =>
                d.CompanyId == companyId && d.Name == name && (excludeId == null || d.Id != excludeId));
    }
}
