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

        // Make this the company's one default stamp, clearing the previous one.
        Task SetDefaultAsync(int companyId, int stampId);

        // How many print templates currently render this stamp. Shown before
        // deleting so the operator knows what will start printing unsigned.
        Task<int> TemplateUsageCountAsync(int stampId);
    }
}
