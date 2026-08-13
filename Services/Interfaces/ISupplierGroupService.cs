using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Mirror of <see cref="IClientGroupService"/> for the purchase
    /// side. Single source of truth for ComputeGroupKey on suppliers —
    /// every other path that needs to know "what group does this
    /// supplier belong to" comes through here so normalisation rules
    /// stay consistent with Common Clients.
    /// </summary>
    public interface ISupplierGroupService
    {
        Task<SupplierGroup> EnsureGroupForSupplierAsync(Supplier supplier);
        // Every read is scoped to the caller's accessible companies — see the
        // matching members on IClientGroupService for the full rationale.
        // "Common" is relative to the caller: an operator holding one company
        // sees an empty panel rather than the names of unreachable tenants.
        Task<List<CommonSupplierDto>> GetCommonSuppliersAsync(int companyId, IReadOnlyCollection<int> accessibleCompanyIds);
        Task<List<CommonSupplierDto>> GetAllGroupsAsync(IReadOnlyCollection<int> accessibleCompanyIds);
        Task<CommonSupplierDetailDto?> GetByIdAsync(int groupId, IReadOnlyCollection<int> accessibleCompanyIds);
        Task<CommonSupplierUpdateResultDto> UpdateAsync(int groupId, CommonSupplierUpdateDto dto, IReadOnlyCollection<int> accessibleCompanyIds);
        Task<CommonSupplierUpdateResultDto> DeleteAsync(int groupId, IReadOnlyCollection<int> accessibleCompanyIds);
        (string GroupKey, string? NormalizedNtn, string NormalizedName) ComputeGroupKey(string? name, string? ntn);
    }
}
