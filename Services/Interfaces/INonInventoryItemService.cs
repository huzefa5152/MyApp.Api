using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Per-company CRUD for Non-Inventory Items (GL-account shortcut lines like
    /// Freight / Discount). Company access is asserted by the controller; this
    /// service enforces the cross-tenant account-link guard + name uniqueness.
    /// </summary>
    public interface INonInventoryItemService
    {
        Task<List<NonInventoryItemDto>> GetByCompanyAsync(int companyId, bool activeOnly = false);
        Task<NonInventoryItemDto?> GetByIdAsync(int id);
        Task<NonInventoryItemDto> CreateAsync(int companyId, NonInventoryItemDto dto);
        Task<NonInventoryItemDto?> UpdateAsync(int id, NonInventoryItemDto dto);
        Task<bool> DeleteAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
