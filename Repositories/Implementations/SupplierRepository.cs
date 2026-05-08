using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class SupplierRepository : ISupplierRepository
    {
        private readonly AppDbContext _db;
        public SupplierRepository(AppDbContext db) => _db = db;

        public async Task<IEnumerable<Supplier>> GetAllAsync() =>
            await _db.Suppliers.AsNoTracking().ToListAsync();

        public async Task<IEnumerable<Supplier>> GetByCompanyAsync(int companyId) =>
            await _db.Suppliers.AsNoTracking()
                .Where(s => s.CompanyId == companyId)
                .OrderBy(s => s.Name)
                .ToListAsync();

        public async Task<Supplier?> GetByIdAsync(int id) =>
            await _db.Suppliers.FindAsync(id);

        public async Task<Supplier> CreateAsync(Supplier supplier)
        {
            _db.Suppliers.Add(supplier);
            await _db.SaveChangesAsync();
            return supplier;
        }

        public async Task<Supplier?> UpdateAsync(Supplier supplier)
        {
            _db.Suppliers.Update(supplier);
            await _db.SaveChangesAsync();
            return supplier;
        }

        public async Task DeleteAsync(Supplier supplier)
        {
            _db.Suppliers.Remove(supplier);
            await _db.SaveChangesAsync();
        }

        public async Task<bool> ExistsWithNameAsync(string name, int companyId, int? excludeId = null)
        {
            return await _db.Suppliers.AnyAsync(s =>
                s.Name.ToLower() == name.ToLower() &&
                s.CompanyId == companyId &&
                (excludeId == null || s.Id != excludeId));
        }

        public async Task<Dictionary<int, bool>> HasPurchaseBillsForSuppliersAsync(IEnumerable<int> supplierIds)
        {
            var ids = supplierIds.Distinct().ToList();
            if (ids.Count == 0) return new Dictionary<int, bool>();
            var withBills = await _db.PurchaseBills
                .Where(pb => ids.Contains(pb.SupplierId))
                .Select(pb => pb.SupplierId)
                .Distinct()
                .ToListAsync();
            var set = new HashSet<int>(withBills);
            return ids.ToDictionary(id => id, id => set.Contains(id));
        }

        public async Task<bool> HasPurchaseBillsAsync(int supplierId) =>
            await _db.PurchaseBills.AnyAsync(pb => pb.SupplierId == supplierId);
    }
}
