using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations
{
    public class ItemTypeService : IItemTypeService
    {
        private readonly IItemTypeRepository _repo;
        private readonly AppDbContext _context;
        private readonly ITaxMappingEngine _taxEngine;

        public ItemTypeService(
            IItemTypeRepository repo,
            AppDbContext context,
            ITaxMappingEngine taxEngine)
        {
            _repo = repo;
            _context = context;
            _taxEngine = taxEngine;
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

        public async Task<ItemTypeDto> CreateAsync(ItemTypeDto dto, int? enrichWithCompanyId = null)
        {
            if (await _repo.ExistsByNameAsync(dto.Name))
                throw new InvalidOperationException($"An item with name '{dto.Name}' already exists.");

            if (!string.IsNullOrWhiteSpace(dto.HSCode) && await _repo.ExistsByHsCodeAsync(dto.HSCode))
                throw new InvalidOperationException(
                    $"An item with HS Code '{dto.HSCode}' already exists in your catalog. " +
                    "Each HS Code can only be mapped to one item.");

            await EnrichFromFbrAsync(dto, enrichWithCompanyId);

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

        public async Task<ItemTypeDto?> UpdateAsync(int id, ItemTypeDto dto, int? enrichWithCompanyId = null)
        {
            var it = await _repo.GetByIdAsync(id);
            if (it == null) return null;

            if (await _repo.ExistsByNameAsync(dto.Name, id))
                throw new InvalidOperationException($"An item with name '{dto.Name}' already exists.");

            if (!string.IsNullOrWhiteSpace(dto.HSCode) && await _repo.ExistsByHsCodeAsync(dto.HSCode, id))
                throw new InvalidOperationException(
                    $"Another item in your catalog already uses HS Code '{dto.HSCode}'. " +
                    "Each HS Code can only be mapped to one item.");

            await EnrichFromFbrAsync(dto, enrichWithCompanyId);

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

        // When the controller passes enrichWithCompanyId and the operator hasn't
        // pre-picked a UOM, ask the tax engine for the FBR-published UOM list
        // for this HS code and store the first match. Catalog stays accurate
        // without forcing the user to scroll the global UOM list — and a stale
        // / missing UOM no longer silently drifts the bill into a 0052 error.
        private async Task EnrichFromFbrAsync(ItemTypeDto dto, int? enrichWithCompanyId)
        {
            if (enrichWithCompanyId == null) return;
            if (string.IsNullOrWhiteSpace(dto.HSCode)) return;
            // Only fill blanks — never overwrite a UOM the user explicitly chose.
            if (dto.FbrUOMId.HasValue && !string.IsNullOrWhiteSpace(dto.UOM)) return;

            try
            {
                var suggested = await _taxEngine.SuggestDefaultUomAsync(
                    enrichWithCompanyId.Value, dto.HSCode!);
                if (suggested == null) return;

                if (!dto.FbrUOMId.HasValue)       dto.FbrUOMId = suggested.UOM_ID;
                if (string.IsNullOrWhiteSpace(dto.UOM)) dto.UOM = suggested.Description;
            }
            catch
            {
                // Non-fatal — FBR token may be missing / network down. The
                // operator can still save and pick UOM manually afterwards.
            }
        }

        /// <summary>
        /// HS codes already in use by any existing item type. Frontend passes this
        /// to HsCodeAutocomplete so the FBR catalog search hides codes already saved.
        /// </summary>
        public async Task<List<string>> GetSavedHsCodesAsync()
            => await _repo.GetSavedHsCodesAsync();

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
