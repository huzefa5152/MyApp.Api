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
        /// <summary>True if another item type already uses this HS Code.</summary>
        Task<bool> ExistsByHsCodeAsync(string hsCode, int? excludeId = null);
        /// <summary>All HS codes currently saved on item types (non-null / non-empty).</summary>
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
