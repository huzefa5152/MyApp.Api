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
        ///
        /// <paramref name="aggregateAcrossCompanyIds"/> takes precedence
        /// when supplied: AvailableQty is summed across every tracking-
        /// enabled company in the set. Used by the Item Catalog admin page
        /// so the operator sees a single global on-hand number per item
        /// regardless of the global company filter.
        /// </summary>
        Task<List<ItemTypeDto>> GetAllAsync(
            int? companyId = null,
            IEnumerable<int>? aggregateAcrossCompanyIds = null);
        Task<ItemTypeDto?> GetByIdAsync(int id);
        Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task DeleteAsync(int id);
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
