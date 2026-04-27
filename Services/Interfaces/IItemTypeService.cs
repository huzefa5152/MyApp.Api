using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IItemTypeService
    {
        Task<List<ItemTypeDto>> GetAllAsync();
        Task<ItemTypeDto?> GetByIdAsync(int id);
        Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null);
        Task DeleteAsync(int id);
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
