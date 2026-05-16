using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class ItemTypeRepository : IItemTypeRepository
    {
        private readonly AppDbContext _context;

        public ItemTypeRepository(AppDbContext context)
        {
            _context = context;
        }

        public async Task<List<ItemType>> GetAllAsync()
            => await _context.ItemTypes
                .Where(it => !it.IsDeleted)
                .OrderBy(it => it.Name)
                .ToListAsync();

        // FindByIdAsync still resolves soft-deleted rows so that propagation
        // / edit-by-id flows see them when needed. The service decides
        // whether to expose the row to the caller.
        public async Task<ItemType?> GetByIdAsync(int id)
            => await _context.ItemTypes.FirstOrDefaultAsync(it => it.Id == id);

        public async Task<ItemType> CreateAsync(ItemType itemType)
        {
            _context.ItemTypes.Add(itemType);
            await _context.SaveChangesAsync();
            return itemType;
        }

        public async Task<ItemType> UpdateAsync(ItemType itemType)
        {
            _context.ItemTypes.Update(itemType);
            await _context.SaveChangesAsync();
            return itemType;
        }

        public async Task DeleteAsync(ItemType itemType)
        {
            // Soft delete only — Restrict FK on InvoiceItems / PurchaseItems /
            // StockMovements would block a hard delete the moment the item
            // has been used anywhere. Service-level guard already enforces
            // "no pending FBR submissions" before we get here.
            itemType.IsDeleted = true;
            _context.ItemTypes.Update(itemType);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> ExistsByNameAndHsCodeAsync(string name, string? hsCode, int? excludeId = null)
        {
            var normalizedHs = string.IsNullOrWhiteSpace(hsCode) ? null : hsCode.Trim();
            var loweredName = (name ?? "").Trim().ToLower();
            return await _context.ItemTypes
                .AnyAsync(it => !it.IsDeleted
                              && it.Name.ToLower() == loweredName
                              && it.HSCode == normalizedHs
                              && (!excludeId.HasValue || it.Id != excludeId.Value));
        }

        public async Task<List<string>> GetSavedHsCodesAsync()
        {
            return await _context.ItemTypes
                .Where(it => !it.IsDeleted && it.HSCode != null && it.HSCode != "")
                .Select(it => it.HSCode!)
                .Distinct()
                .ToListAsync();
        }
    }
}
