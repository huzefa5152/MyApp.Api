using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ItemTypeService : IItemTypeService
    {
        private readonly IItemTypeRepository _repo;
        private readonly AppDbContext _context;

        public ItemTypeService(IItemTypeRepository repo, AppDbContext context)
        {
            _repo = repo;
            _context = context;
        }

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

            var inUse = await _context.DeliveryItems.AnyAsync(di => di.ItemTypeId == id);
            if (inUse)
                throw new InvalidOperationException($"Cannot delete \"{it.Name}\" — it is used in existing challans.");

            await _repo.DeleteAsync(it);
        }
    }
}
