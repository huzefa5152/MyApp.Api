using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IItemTypeRepository
    {
        // All read methods exclude soft-deleted rows (IsDeleted=true) so the
        // user-facing pickers / lists never see them. FK lookups inside other
        // services go through _context.ItemTypes directly because historical
        // invoice / purchase / stock rows still need to resolve their
        // ItemType row, even after a soft delete.
        Task<List<ItemType>> GetAllAsync();
        Task<ItemType?> GetByIdAsync(int id);
        Task<ItemType> CreateAsync(ItemType itemType);
        Task<ItemType> UpdateAsync(ItemType itemType);
        /// <summary>
        /// Soft delete — sets IsDeleted=true and saves. Hard delete would fail
        /// against the Restrict FK on InvoiceItems / PurchaseItems /
        /// StockMovements as soon as the row has been referenced anywhere.
        /// </summary>
        Task DeleteAsync(ItemType itemType);
        /// <summary>
        /// Composite check: true if a non-deleted ItemType already has this
        /// (Name, HSCode) pair. NULL HSCode is treated as equal-to-NULL so
        /// two "Hardware Items" rows with no HS code are still rejected as
        /// duplicates — matching the SQL Server unique-index semantics.
        /// </summary>
        Task<bool> ExistsByNameAndHsCodeAsync(string name, string? hsCode, int? excludeId = null);
        /// <summary>All HS codes currently saved on non-deleted item types.</summary>
        Task<List<string>> GetSavedHsCodesAsync();
    }
}
