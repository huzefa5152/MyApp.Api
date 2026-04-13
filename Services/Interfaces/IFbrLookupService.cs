using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    public interface IFbrLookupService
    {
        Task<List<FbrLookup>> GetByCategoryAsync(string category);
        Task<List<FbrLookup>> GetAllAsync();
        Task<FbrLookup> CreateAsync(FbrLookup lookup);
        Task<FbrLookup?> UpdateAsync(int id, FbrLookup lookup);
        Task<bool> DeleteAsync(int id);
    }
}
