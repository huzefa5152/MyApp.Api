using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Operations-side document for the receiving warehouse — distinct from
    /// <see cref="PurchaseBill"/>, which is the finance/tax document. Goods
    /// Receipts are advisory in v1: they don't move stock on their own
    /// (Stock IN is emitted by PurchaseBill save, which is the unambiguous
    /// chokepoint). Receipt rows simply record which physical delivery
    /// arrived for which bill, useful for short-shipment / damage notes.
    /// </summary>
    public class GoodsReceiptService : IGoodsReceiptService
    {
        private readonly AppDbContext _context;

        public GoodsReceiptService(AppDbContext context)
        {
            _context = context;
        }

        private static GoodsReceiptDto ToDto(GoodsReceipt gr) => new()
        {
            Id = gr.Id,
            GoodsReceiptNumber = gr.GoodsReceiptNumber,
            ReceiptDate = gr.ReceiptDate,
            CompanyId = gr.CompanyId,
            SupplierId = gr.SupplierId,
            SupplierName = gr.Supplier?.Name ?? "",
            PurchaseBillId = gr.PurchaseBillId,
            PurchaseBillNumber = gr.PurchaseBill?.PurchaseBillNumber,
            SupplierChallanNumber = gr.SupplierChallanNumber,
            Site = gr.Site,
            Status = gr.Status,
            CreatedAt = gr.CreatedAt,
            Items = gr.Items?.Select(i => new GoodsReceiptItemDto
            {
                Id = i.Id,
                ItemTypeId = i.ItemTypeId,
                ItemTypeName = i.ItemType?.Name ?? "",
                Description = i.Description,
                Quantity = i.Quantity,
                Unit = i.Unit,
            }).ToList() ?? new(),
        };

        public async Task<PagedResult<GoodsReceiptDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            string? status = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var q = _context.GoodsReceipts
                .Include(gr => gr.Supplier)
                .Include(gr => gr.PurchaseBill)
                .Include(gr => gr.Items)
                    .ThenInclude(it => it.ItemType)
                .Where(gr => gr.CompanyId == companyId);
            if (supplierId.HasValue) q = q.Where(gr => gr.SupplierId == supplierId.Value);
            if (!string.IsNullOrWhiteSpace(status)) q = q.Where(gr => gr.Status == status);
            if (dateFrom.HasValue) q = q.Where(gr => gr.ReceiptDate >= dateFrom.Value);
            if (dateTo.HasValue) q = q.Where(gr => gr.ReceiptDate <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                q = q.Where(gr =>
                    gr.GoodsReceiptNumber.ToString().Contains(term) ||
                    (gr.SupplierChallanNumber != null && gr.SupplierChallanNumber.ToLower().Contains(term)) ||
                    (gr.Supplier != null && gr.Supplier.Name.ToLower().Contains(term)) ||
                    gr.Items.Any(it => it.Description.ToLower().Contains(term) ||
                                        (it.ItemType != null && it.ItemType.Name.ToLower().Contains(term))));
            }
            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(gr => gr.GoodsReceiptNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();
            return new PagedResult<GoodsReceiptDto>
            {
                Items = rows.Select(ToDto).ToList(),
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<GoodsReceiptDto?> GetByIdAsync(int id)
        {
            var gr = await _context.GoodsReceipts
                .Include(g => g.Supplier)
                .Include(g => g.PurchaseBill)
                .Include(g => g.Items)
                    .ThenInclude(it => it.ItemType)
                .FirstOrDefaultAsync(g => g.Id == id);
            return gr == null ? null : ToDto(gr);
        }

        public async Task<GoodsReceiptDto> CreateAsync(CreateGoodsReceiptDto dto)
        {
            // Wrap number allocation + receipt insert in one transaction so
            // a concurrent create can't race the MAX(...)+1 lookup.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var company = await _context.Companies.FindAsync(dto.CompanyId);
                if (company == null) throw new KeyNotFoundException("Company not found.");
                var supplier = await _context.Suppliers
                    .FirstOrDefaultAsync(s => s.Id == dto.SupplierId && s.CompanyId == dto.CompanyId);
                if (supplier == null) throw new KeyNotFoundException("Supplier not found.");
                if (dto.PurchaseBillId.HasValue)
                {
                    // Cross-tenant linkage guard: a goods receipt can only
                    // reference a purchase bill of the same company.
                    var billCompanyId = await _context.PurchaseBills
                        .Where(pb => pb.Id == dto.PurchaseBillId.Value)
                        .Select(pb => (int?)pb.CompanyId)
                        .FirstOrDefaultAsync();
                    if (billCompanyId == null)
                        throw new KeyNotFoundException("Purchase bill not found.");
                    if (billCompanyId != dto.CompanyId)
                        throw new InvalidOperationException("Purchase bill belongs to a different company.");
                }
                if (dto.Items == null || dto.Items.Count == 0)
                    throw new InvalidOperationException("At least one item is required.");

                // Number allocation, mirror PurchaseBill numbering.
                var maxNumber = await _context.GoodsReceipts
                    .Where(g => g.CompanyId == dto.CompanyId)
                    .Select(g => (int?)g.GoodsReceiptNumber)
                    .MaxAsync() ?? 0;
                var nextNumber = Math.Max(maxNumber + 1, company.StartingGoodsReceiptNumber);
                company.CurrentGoodsReceiptNumber = nextNumber;

                var receipt = new GoodsReceipt
                {
                    GoodsReceiptNumber = nextNumber,
                    ReceiptDate = dto.ReceiptDate.Date,
                    CompanyId = dto.CompanyId,
                    SupplierId = dto.SupplierId,
                    PurchaseBillId = dto.PurchaseBillId,
                    SupplierChallanNumber = dto.SupplierChallanNumber?.Trim(),
                    Site = dto.Site,
                    Status = "Pending",
                    CreatedAt = DateTime.UtcNow,
                    Items = dto.Items.Select(i => new GoodsReceiptItem
                    {
                        ItemTypeId = i.ItemTypeId,
                        Description = i.Description?.Trim() ?? "",
                        Quantity = i.Quantity,
                        Unit = i.Unit ?? "",
                    }).ToList(),
                };

                _context.GoodsReceipts.Add(receipt);
                await _context.SaveChangesAsync();
                await tx.CommitAsync();
                return (await GetByIdAsync(receipt.Id))!;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<GoodsReceiptDto?> UpdateAsync(int id, UpdateGoodsReceiptDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
            var gr = await _context.GoodsReceipts
                .Include(g => g.Items)
                .FirstOrDefaultAsync(g => g.Id == id);
            if (gr == null) return null;
            if (dto.PurchaseBillId.HasValue)
            {
                // Same cross-tenant linkage guard as Create.
                var billCompanyId = await _context.PurchaseBills
                    .Where(pb => pb.Id == dto.PurchaseBillId.Value)
                    .Select(pb => (int?)pb.CompanyId)
                    .FirstOrDefaultAsync();
                if (billCompanyId == null)
                    throw new KeyNotFoundException("Purchase bill not found.");
                if (billCompanyId != gr.CompanyId)
                    throw new InvalidOperationException("Purchase bill belongs to a different company.");
            }

            gr.ReceiptDate = dto.ReceiptDate.Date;
            gr.SupplierId = dto.SupplierId;
            gr.PurchaseBillId = dto.PurchaseBillId;
            gr.SupplierChallanNumber = dto.SupplierChallanNumber?.Trim();
            gr.Site = dto.Site;
            if (!string.IsNullOrWhiteSpace(dto.Status)) gr.Status = dto.Status;

            // Replace items wholesale (lighter than diff, fine for v1)
            _context.GoodsReceiptItems.RemoveRange(gr.Items);
            gr.Items.Clear();
            foreach (var i in dto.Items)
            {
                gr.Items.Add(new GoodsReceiptItem
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    Unit = i.Unit ?? "",
                });
            }
            await _context.SaveChangesAsync();
            await tx.CommitAsync();
            return await GetByIdAsync(gr.Id);
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<bool> DeleteAsync(int id)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var gr = await _context.GoodsReceipts.FindAsync(id);
                if (gr == null) return false;
                _context.GoodsReceipts.Remove(gr);
                await _context.SaveChangesAsync();
                await tx.CommitAsync();
                return true;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }
    }
}
