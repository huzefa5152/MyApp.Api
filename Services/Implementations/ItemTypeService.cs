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

        private static ItemTypeDto ToDto(ItemType it) => new()
        {
            Id = it.Id,
            Name = it.Name,
            HSCode = it.HSCode,
            UOM = it.UOM,
            FbrUOMId = it.FbrUOMId,
            SaleType = it.SaleType,
            FbrDescription = it.FbrDescription,
            IsFavorite = it.IsFavorite,
            UsageCount = it.UsageCount,
        };

        public async Task<List<ItemTypeDto>> GetAllAsync()
        {
            var items = await _repo.GetAllAsync();
            return items
                // Favorites first, then by usage, then alphabetical — matches what the
                // challan/bill dropdowns want to surface
                .OrderByDescending(it => it.IsFavorite)
                .ThenByDescending(it => it.UsageCount)
                .ThenBy(it => it.Name)
                .Select(ToDto)
                .ToList();
        }

        public async Task<ItemTypeDto?> GetByIdAsync(int id)
        {
            var it = await _repo.GetByIdAsync(id);
            return it == null ? null : ToDto(it);
        }

        public async Task<ItemTypeDto> CreateAsync(ItemTypeDto dto)
        {
            if (await _repo.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"Item type '{dto.Name}' already exists.");

            var created = await _repo.CreateAsync(new ItemType
            {
                Name = dto.Name,
                HSCode = dto.HSCode,
                UOM = dto.UOM,
                FbrUOMId = dto.FbrUOMId,
                SaleType = dto.SaleType,
                FbrDescription = dto.FbrDescription,
                IsFavorite = dto.IsFavorite,
            });
            return ToDto(created);
        }

        public async Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) return null;

            if (await _repo.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"Item type '{dto.Name}' already exists.");

            it.Name = dto.Name;
            it.HSCode = dto.HSCode;
            it.UOM = dto.UOM;
            it.FbrUOMId = dto.FbrUOMId;
            it.SaleType = dto.SaleType;
            it.FbrDescription = dto.FbrDescription;
            it.IsFavorite = dto.IsFavorite;
            var updated = await _repo.UpdateAsync(it);
            return ToDto(updated);
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
