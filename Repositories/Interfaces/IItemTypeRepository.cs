using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IItemTypeRepository
    {
        Task<List<ItemType>> GetAllAsync();
        Task<ItemType?> GetByIdAsync(int id);
        Task<ItemType> CreateAsync(ItemType itemType);
        Task<ItemType> UpdateAsync(ItemType itemType);
        Task DeleteAsync(ItemType itemType);
        Task<bool> ExistsByNameAsync(string name, int? excludeId = null);
    }
}
