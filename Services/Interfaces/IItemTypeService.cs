using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IItemTypeService
    {
        Task<List<ItemTypeDto>> GetAllAsync();
        Task<ItemTypeDto?> GetByIdAsync(int id);
        Task<ItemTypeDto> CreateAsync(ItemTypeDto dto);
        Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto);
        Task DeleteAsync(int id);
    }
}
