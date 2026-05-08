using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ISupplierRepository
    {
        Task<IEnumerable<Supplier>> GetAllAsync();
        Task<IEnumerable<Supplier>> GetByCompanyAsync(int companyId);
        Task<Supplier?> GetByIdAsync(int id);
        Task<Supplier> CreateAsync(Supplier supplier);
        Task<Supplier?> UpdateAsync(Supplier supplier);
        Task DeleteAsync(Supplier supplier);
        Task<bool> ExistsWithNameAsync(string name, int companyId, int? excludeId = null);

        /// <summary>
        /// Bulk lookup: which of these supplier ids have at least one
        /// PurchaseBill posted against them. Used by the list view to
        /// disable Delete on rows with bookings.
        /// </summary>
        Task<Dictionary<int, bool>> HasPurchaseBillsForSuppliersAsync(IEnumerable<int> supplierIds);

        /// <summary>True if this single supplier has any PurchaseBill.</summary>
        Task<bool> HasPurchaseBillsAsync(int supplierId);
    }
}
