using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IItemTypeService
    {
        /// <summary>
        /// Returns the full Item Type catalog. When <paramref name="companyId"/>
        /// is set AND that company has inventory tracking enabled, every
        /// returned DTO carries the per-company AvailableQty and the
        /// list is sorted so items with available stock surface first.
        /// Without companyId (or when tracking is off) the legacy
        /// favorite / usage / alpha sort is used.
        /// </summary>
        Task<List<ItemTypeDto>> GetAllAsync(int? companyId = null);
        Task<ItemTypeDto?> GetByIdAsync(int id);
        Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task DeleteAsync(int id);
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
