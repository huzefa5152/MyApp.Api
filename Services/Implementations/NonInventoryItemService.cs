using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Non-Inventory Items — per-company GL-account shortcut line items
    /// (Freight, Discount, service fees). No stock, no FBR. See
    /// <see cref="INonInventoryItemService"/>. Account links are validated
    /// against the SAME company (cross-tenant link guard); name uniqueness is
    /// enforced by a (CompanyId, Name) unique index + a friendly pre-check.
    /// </summary>
    public class NonInventoryItemService : INonInventoryItemService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<NonInventoryItemService> _logger;

        public NonInventoryItemService(AppDbContext context, ILogger<NonInventoryItemService> logger)
        {
            _context = context;
            _logger = logger;
        }

        private static NonInventoryItemDto ToDto(NonInventoryItem n) => new()
        {
            Id = n.Id,
            CompanyId = n.CompanyId,
            Name = n.Name,
            Code = n.Code,
            UnitName = n.UnitName,
            SaleAccountId = n.SaleAccountId,
            SaleAccountName = n.SaleAccount?.Name,
            PurchaseAccountId = n.PurchaseAccountId,
            PurchaseAccountName = n.PurchaseAccount?.Name,
            DefaultLineDescription = n.DefaultLineDescription,
            DefaultSalePrice = n.DefaultSalePrice,
            DefaultPurchasePrice = n.DefaultPurchasePrice,
            HideNameOnPrint = n.HideNameOnPrint,
            IsActive = n.IsActive,
            CreatedAt = n.CreatedAt,
        };

        public async Task<List<NonInventoryItemDto>> GetByCompanyAsync(int companyId, bool activeOnly = false)
        {
            var q = _context.NonInventoryItems.AsNoTracking()
                .Include(n => n.SaleAccount)
                .Include(n => n.PurchaseAccount)
                .Where(n => n.CompanyId == companyId);
            if (activeOnly) q = q.Where(n => n.IsActive);
            var rows = await q.OrderBy(n => n.Name).ToListAsync();
            return rows.Select(ToDto).ToList();
        }

        public async Task<NonInventoryItemDto?> GetByIdAsync(int id)
        {
            var n = await _context.NonInventoryItems.AsNoTracking()
                .Include(x => x.SaleAccount)
                .Include(x => x.PurchaseAccount)
                .FirstOrDefaultAsync(x => x.Id == id);
            return n == null ? null : ToDto(n);
        }

        public async Task<int> GetCountByCompanyAsync(int companyId) =>
            await _context.NonInventoryItems.CountAsync(n => n.CompanyId == companyId);

        public async Task<NonInventoryItemDto> CreateAsync(int companyId, NonInventoryItemDto dto)
        {
            await ValidateAsync(companyId, dto, existingId: null);

            var entity = new NonInventoryItem
            {
                CompanyId = companyId,
                Name = dto.Name.Trim(),
                Code = Clean(dto.Code),
                UnitName = Clean(dto.UnitName),
                SaleAccountId = dto.SaleAccountId,
                PurchaseAccountId = dto.PurchaseAccountId,
                DefaultLineDescription = Clean(dto.DefaultLineDescription),
                DefaultSalePrice = dto.DefaultSalePrice,
                DefaultPurchasePrice = dto.DefaultPurchasePrice,
                HideNameOnPrint = dto.HideNameOnPrint,
                IsActive = dto.IsActive,
                CreatedAt = DateTime.UtcNow,
            };
            _context.NonInventoryItems.Add(entity);
            await _context.SaveChangesAsync();
            return (await GetByIdAsync(entity.Id))!;
        }

        public async Task<NonInventoryItemDto?> UpdateAsync(int id, NonInventoryItemDto dto)
        {
            var entity = await _context.NonInventoryItems.FirstOrDefaultAsync(n => n.Id == id);
            if (entity == null) return null;

            // Validate against the STORED company, never the DTO's (forgeable).
            await ValidateAsync(entity.CompanyId, dto, existingId: id);

            entity.Name = dto.Name.Trim();
            entity.Code = Clean(dto.Code);
            entity.UnitName = Clean(dto.UnitName);
            entity.SaleAccountId = dto.SaleAccountId;
            entity.PurchaseAccountId = dto.PurchaseAccountId;
            entity.DefaultLineDescription = Clean(dto.DefaultLineDescription);
            entity.DefaultSalePrice = dto.DefaultSalePrice;
            entity.DefaultPurchasePrice = dto.DefaultPurchasePrice;
            entity.HideNameOnPrint = dto.HideNameOnPrint;
            entity.IsActive = dto.IsActive;
            // CompanyId is immutable on update.

            await _context.SaveChangesAsync();
            return await GetByIdAsync(id);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var entity = await _context.NonInventoryItems.FirstOrDefaultAsync(n => n.Id == id);
            if (entity == null) return false;

            // Restrict FKs mean a referenced item can't be hard-deleted. Give a
            // clear message pointing at the soft-disable (IsActive) path so the
            // sequence of historical lines stays intact.
            var used = await _context.InvoiceItems.AnyAsync(i => i.NonInventoryItemId == id)
                    || await _context.PurchaseItems.AnyAsync(p => p.NonInventoryItemId == id)
                    || await _context.SalesQuoteItems.AnyAsync(q => q.NonInventoryItemId == id);
            if (used)
                throw new InvalidOperationException(
                    "This non-inventory item is used on existing documents and can't be deleted. Deactivate it instead to hide it from new documents.");

            _context.NonInventoryItems.Remove(entity);
            await _context.SaveChangesAsync();
            return true;
        }

        private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        private async Task ValidateAsync(int companyId, NonInventoryItemDto dto, int? existingId)
        {
            if (string.IsNullOrWhiteSpace(dto.Name))
                throw new InvalidOperationException("A name is required.");

            var name = dto.Name.Trim();
            var clash = await _context.NonInventoryItems.AsNoTracking()
                .AnyAsync(n => n.CompanyId == companyId && n.Name == name && (existingId == null || n.Id != existingId));
            if (clash)
                throw new InvalidOperationException($"A non-inventory item named \"{name}\" already exists for this company.");

            await AssertAccountAsync(companyId, dto.SaleAccountId, "sale");
            await AssertAccountAsync(companyId, dto.PurchaseAccountId, "purchase");
        }

        // Cross-tenant link guard: an account mapping must point at THIS company's
        // chart of accounts.
        private async Task AssertAccountAsync(int companyId, int? accountId, string side)
        {
            if (!accountId.HasValue) return;
            var ok = await _context.Accounts.AsNoTracking()
                .AnyAsync(a => a.Id == accountId.Value && a.CompanyId == companyId);
            if (!ok)
                throw new InvalidOperationException($"The selected {side} account belongs to a different company.");
        }
    }
}
