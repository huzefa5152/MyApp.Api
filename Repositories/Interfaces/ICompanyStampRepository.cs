using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ICompanyStampRepository
    {
        Task<List<CompanyStamp>> GetByCompanyAsync(int companyId);
        Task<CompanyStamp?> GetByIdAsync(int id);
        Task<bool> SlugExistsAsync(int companyId, string slug);
        Task<int> NextSortOrderAsync(int companyId);
        Task<CompanyStamp> CreateAsync(CompanyStamp stamp);
        Task SaveAsync();
        Task DeleteAsync(CompanyStamp stamp);
    }
}
