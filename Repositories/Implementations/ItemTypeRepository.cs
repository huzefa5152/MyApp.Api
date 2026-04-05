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
            => await _context.ItemTypes.OrderBy(it => it.Name).ToListAsync();

        public async Task<ItemType?> GetByIdAsync(int id)
            => await _context.ItemTypes.FindAsync(id);

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
            _context.ItemTypes.Remove(itemType);
            await _context.SaveChangesAsync();
        }

        public async Task<bool> ExistsByNameAsync(string name, int? excludeId = null)
        {
            return await _context.ItemTypes
                .AnyAsync(it => it.Name.ToLower() == name.ToLower() &&
                               (!excludeId.HasValue || it.Id != excludeId.Value));
        }
    }
}
