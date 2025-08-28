using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ICompanyRepository
    {
        Task<IEnumerable<Company>> GetAllAsync();
        Task<Company?> GetByIdAsync(int id);
        Task<Company> AddAsync(Company company);
        Task<Company> UpdateAsync(Company company);
        Task DeleteAsync(Company company);
        Task<bool> ExistsAsync(int id);

        // ✅ New method for duplicate check
        Task<bool> ExistsByNameAsync(string name, int? excludeId = null);
    }
}
