using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IDivisionRepository
    {
        Task<List<Division>> GetByCompanyAsync(int companyId);
        Task<Division?> GetByIdAsync(int id);
        Task<Division> AddAsync(Division division);
        Task<Division> UpdateAsync(Division division);
        Task DeleteAsync(Division division);
        Task<bool> ExistsByNameAsync(int companyId, string name, int? excludeId = null);
    }
}
