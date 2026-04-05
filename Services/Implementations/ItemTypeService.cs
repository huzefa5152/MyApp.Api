using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ItemTypeService : IItemTypeService
    {
        private readonly IItemTypeRepository _repo;

        public ItemTypeService(IItemTypeRepository repo) => _repo = repo;

        public async Task<List<ItemTypeDto>> GetAllAsync()
        {
            var items = await _repo.GetAllAsync();
            return items.Select(it => new ItemTypeDto { Id = it.Id, Name = it.Name }).ToList();
        }

        public async Task<ItemTypeDto?> GetByIdAsync(int id)
        {
            var it = await _repo.GetByIdAsync(id);
            return it == null ? null : new ItemTypeDto { Id = it.Id, Name = it.Name };
        }

        public async Task<ItemTypeDto> CreateAsync(ItemTypeDto dto)
        {
            if (await _repo.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"Item type '{dto.Name}' already exists.");

            var created = await _repo.CreateAsync(new ItemType { Name = dto.Name });
            return new ItemTypeDto { Id = created.Id, Name = created.Name };
        }

        public async Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) return null;

            if (await _repo.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"Item type '{dto.Name}' already exists.");

            it.Name = dto.Name;
            var updated = await _repo.UpdateAsync(it);
            return new ItemTypeDto { Id = updated.Id, Name = updated.Name };
        }

        public async Task DeleteAsync(int id)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) throw new KeyNotFoundException("Item type not found.");
            await _repo.DeleteAsync(it);
        }
    }
}
