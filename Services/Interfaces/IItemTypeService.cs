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
        /// <param name="divisionRestrictionsByCompany">Division-RBAC scope
        /// (IDivisionAccessGuard.GetRestrictionsAsync shape). Applies to
        /// whichever on-hand path runs: restricted companies only sum
        /// company-level movements plus the listed divisions'.</param>
        Task<List<ItemTypeDto>> GetAllAsync(
            int? companyId = null,
            IEnumerable<int>? aggregateAcrossCompanyIds = null,
            Dictionary<int, HashSet<int>>? divisionRestrictionsByCompany = null);
        /// <summary>When <paramref name="companyId"/> is set, the returned DTO
        /// carries that company's overlay (division + GL account mapping).</summary>
        Task<ItemTypeDto?> GetByIdAsync(int id, int? companyId = null);
        /// <summary>Creates the shared ItemType (dedup on Name+HSCode). When
        /// <paramref name="companyId"/> is set, also upserts that company's
        /// CompanyItemTypeSetting overlay from the DTO's DivisionId /
        /// SaleAccountId / PurchaseAccountId (design §3.1/§7).</summary>
        Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? companyId = null);
        Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? companyId = null);
        Task DeleteAsync(int id);
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
