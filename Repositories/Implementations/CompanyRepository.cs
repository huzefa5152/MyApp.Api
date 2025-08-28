using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class CompanyRepository : ICompanyRepository
    {
        private readonly AppDbContext _context;

        public CompanyRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<IEnumerable<Company>> GetAllAsync()
            => await _context.Companies.ToListAsync();

        public async Task<Company?> GetByIdAsync(int id)
            => await _context.Companies.FindAsync(id);

        public async Task<Company> AddAsync(Company company)
        {
            _context.Companies.Add(company);
            await _context.SaveChangesAsync();
            return company;
        }

        public async Task<Company> UpdateAsync(Company company)
        {
            _context.Companies.Update(company);
            await _context.SaveChangesAsync();
            return company;
        }

        public async Task DeleteAsync(Company company)
        {
            _context.Companies.Remove(company);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> ExistsAsync(int id)
            => await _context.Companies.AnyAsync(c => c.Id == id);

        // ✅ Duplicate check
        public async Task<bool> ExistsByNameAsync(string name, int? excludeId = null)
        {
            return await _context.Companies
                .AnyAsync(c => c.Name.ToLower() == name.ToLower() &&
                              (!excludeId.HasValue || c.Id != excludeId.Value));
        }
    }
}
