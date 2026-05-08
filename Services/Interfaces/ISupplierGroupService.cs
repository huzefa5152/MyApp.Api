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
        Task<List<CommonSupplierDto>> GetCommonSuppliersAsync(int companyId);
        Task<List<CommonSupplierDto>> GetAllGroupsAsync();
        Task<CommonSupplierDetailDto?> GetByIdAsync(int groupId);
        Task<CommonSupplierUpdateResultDto> UpdateAsync(int groupId, CommonSupplierUpdateDto dto);
        Task<CommonSupplierUpdateResultDto> DeleteAsync(int groupId);
        (string GroupKey, string? NormalizedNtn, string NormalizedName) ComputeGroupKey(string? name, string? ntn);
    }
}
