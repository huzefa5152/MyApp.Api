using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Purchase-side counterpart of <see cref="InvoiceService"/>. Records the
    /// supplier's invoice (with their IRN), allocates a per-company purchase
    /// bill number, and emits Stock IN movements when inventory tracking is
    /// on. Delete reverses any movements emitted by the bill.
    /// </summary>
    public class PurchaseBillService : IPurchaseBillService
    {
        private readonly AppDbContext _context;
        private readonly IStockService _stock;

        public PurchaseBillService(AppDbContext context, IStockService stock)
        {
            _context = context;
            _stock = stock;
        }

        private static PurchaseBillDto ToDto(PurchaseBill pb) => new()
        {
            Id = pb.Id,
            PurchaseBillNumber = pb.PurchaseBillNumber,
            Date = pb.Date,
            CompanyId = pb.CompanyId,
            CompanyName = pb.Company?.Name ?? "",
            SupplierId = pb.SupplierId,
            SupplierName = pb.Supplier?.Name ?? "",
            SupplierBillNumber = pb.SupplierBillNumber,
            SupplierIRN = pb.SupplierIRN,
            Subtotal = pb.Subtotal,
            GSTRate = pb.GSTRate,
            GSTAmount = pb.GSTAmount,
            GrandTotal = pb.GrandTotal,
            AmountInWords = pb.AmountInWords,
            PaymentTerms = pb.PaymentTerms,
            DocumentType = pb.DocumentType,
            PaymentMode = pb.PaymentMode,
            ReconciliationStatus = pb.ReconciliationStatus,
            CreatedAt = pb.CreatedAt,
            Items = pb.Items?.Select(i => new PurchaseItemDto
            {
                Id = i.Id,
                ItemTypeId = i.ItemTypeId,
                ItemTypeName = i.ItemType?.Name ?? i.ItemTypeName,
                Description = i.Description,
                Quantity = i.Quantity,
                UOM = i.UOM,
                UnitPrice = i.UnitPrice,
                LineTotal = i.LineTotal,
                HSCode = i.HSCode,
                FbrUOMId = i.FbrUOMId,
                SaleType = i.SaleType,
                RateId = i.RateId,
                FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
            }).ToList() ?? new(),
        };

        public async Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var q = _context.PurchaseBills
                .Include(pb => pb.Supplier)
                .Include(pb => pb.Items)
                    .ThenInclude(pi => pi.ItemType)
                .Where(pb => pb.CompanyId == companyId);
            if (supplierId.HasValue)
                q = q.Where(pb => pb.SupplierId == supplierId.Value);
            if (dateFrom.HasValue)
                q = q.Where(pb => pb.Date >= dateFrom.Value);
            if (dateTo.HasValue)
                q = q.Where(pb => pb.Date <= dateTo.Value);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = search.ToLower();
                q = q.Where(pb =>
                    pb.PurchaseBillNumber.ToString().Contains(term) ||
                    (pb.SupplierBillNumber != null && pb.SupplierBillNumber.ToLower().Contains(term)) ||
                    (pb.SupplierIRN != null && pb.SupplierIRN.ToLower().Contains(term)) ||
                    (pb.Supplier != null && pb.Supplier.Name.ToLower().Contains(term)) ||
                    pb.Items.Any(it => it.Description.ToLower().Contains(term) ||
                                        (it.ItemType != null && it.ItemType.Name.ToLower().Contains(term))));
            }
            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(pb => pb.PurchaseBillNumber)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync();
            return new PagedResult<PurchaseBillDto>
            {
                Items = rows.Select(ToDto).ToList(),
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            };
        }

        public async Task<PurchaseBillDto?> GetByIdAsync(int id)
        {
            var pb = await _context.PurchaseBills
                .Include(p => p.Company)
                .Include(p => p.Supplier)
                .Include(p => p.Items)
                    .ThenInclude(pi => pi.ItemType)
                .FirstOrDefaultAsync(p => p.Id == id);
            return pb == null ? null : ToDto(pb);
        }

        public async Task<PurchaseBillDto> CreateAsync(CreatePurchaseBillDto dto)
        {
            var company = await _context.Companies.FindAsync(dto.CompanyId);
            if (company == null) throw new KeyNotFoundException("Company not found.");
            var supplier = await _context.Suppliers
                .FirstOrDefaultAsync(s => s.Id == dto.SupplierId && s.CompanyId == dto.CompanyId);
            if (supplier == null) throw new KeyNotFoundException("Supplier not found.");
            if (dto.Items == null || dto.Items.Count == 0)
                throw new InvalidOperationException("At least one item is required.");
            if (dto.Items.Any(i => i.Quantity <= 0))
                throw new InvalidOperationException("Quantity must be greater than zero.");
            if (dto.Items.Any(i => i.UnitPrice < 0))
                throw new InvalidOperationException("Unit price cannot be negative.");

            // Allocate next purchase-bill number — independent of the
            // sales-side InvoiceNumber sequence.
            var maxNumber = await _context.PurchaseBills
                .Where(p => p.CompanyId == dto.CompanyId)
                .Select(p => (int?)p.PurchaseBillNumber)
                .MaxAsync() ?? 0;
            var nextNumber = Math.Max(maxNumber + 1, company.StartingPurchaseBillNumber);
            company.CurrentPurchaseBillNumber = nextNumber;

            var items = new List<PurchaseItem>();
            foreach (var i in dto.Items)
            {
                ItemType? itemType = i.ItemTypeId.HasValue
                    ? await _context.ItemTypes.FindAsync(i.ItemTypeId.Value)
                    : null;
                items.Add(new PurchaseItem
                {
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = itemType?.Name ?? "",
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    UOM = i.UOM ?? itemType?.UOM ?? "",
                    UnitPrice = i.UnitPrice,
                    LineTotal = Math.Round(i.Quantity * i.UnitPrice, 2),
                    HSCode = i.HSCode ?? itemType?.HSCode,
                    FbrUOMId = i.FbrUOMId ?? itemType?.FbrUOMId,
                    SaleType = i.SaleType ?? itemType?.SaleType,
                    RateId = i.RateId,
                    FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
                });
            }

            var subtotal = items.Sum(x => x.LineTotal);
            var gstAmount = Math.Round(subtotal * dto.GSTRate / 100m, 2);
            var grandTotal = subtotal + gstAmount;

            var bill = new PurchaseBill
            {
                PurchaseBillNumber = nextNumber,
                Date = dto.Date.Date,
                CompanyId = dto.CompanyId,
                SupplierId = dto.SupplierId,
                SupplierBillNumber = dto.SupplierBillNumber?.Trim(),
                SupplierIRN = dto.SupplierIRN?.Trim(),
                Subtotal = subtotal,
                GSTRate = dto.GSTRate,
                GSTAmount = gstAmount,
                GrandTotal = grandTotal,
                AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                PaymentTerms = dto.PaymentTerms,
                DocumentType = dto.DocumentType,
                PaymentMode = dto.PaymentMode,
                ReconciliationStatus = string.IsNullOrWhiteSpace(dto.SupplierIRN) ? "ManualOnly" : "Pending",
                Items = items,
                CreatedAt = DateTime.UtcNow,
            };

            _context.PurchaseBills.Add(bill);
            await _context.SaveChangesAsync();

            // Emit Stock IN for every line that's bound to a catalog item.
            // No-op when Company.InventoryTrackingEnabled is false.
            foreach (var it in items)
            {
                if (!it.ItemTypeId.HasValue || it.Quantity <= 0) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: it.ItemTypeId.Value,
                    direction: StockMovementDirection.In,
                    quantity: it.Quantity,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Purchase Bill #{bill.PurchaseBillNumber} from {supplier.Name}");
            }

            return (await GetByIdAsync(bill.Id))!;
        }

        public async Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto)
        {
            var bill = await _context.PurchaseBills
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (bill == null) return null;

            // Reverse previously emitted Stock IN before applying changes,
            // then re-emit using the new line set. Simpler than diff-by-line
            // and the StockMovement log preserves the audit trail (compensating
            // OUT entries are inserted, not the IN rows mutated).
            var oldItems = bill.Items.ToList();
            foreach (var oi in oldItems)
            {
                if (!oi.ItemTypeId.HasValue || oi.Quantity <= 0) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: oi.ItemTypeId.Value,
                    direction: StockMovementDirection.Out,
                    quantity: oi.Quantity,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Reversal — Purchase Bill #{bill.PurchaseBillNumber} edited");
            }

            // Apply header changes
            if (dto.Date.HasValue) bill.Date = dto.Date.Value.Date;
            bill.SupplierBillNumber = dto.SupplierBillNumber?.Trim();
            bill.SupplierIRN = dto.SupplierIRN?.Trim();
            bill.GSTRate = dto.GSTRate;
            bill.PaymentTerms = dto.PaymentTerms;
            bill.DocumentType = dto.DocumentType;
            bill.PaymentMode = dto.PaymentMode;
            bill.ReconciliationStatus = string.IsNullOrWhiteSpace(dto.SupplierIRN) ? "ManualOnly" : bill.ReconciliationStatus;

            // Replace items wholesale (simpler than a diff, fine for v1)
            _context.PurchaseItems.RemoveRange(bill.Items);
            bill.Items.Clear();

            var newItems = new List<PurchaseItem>();
            foreach (var i in dto.Items)
            {
                ItemType? itemType = i.ItemTypeId.HasValue
                    ? await _context.ItemTypes.FindAsync(i.ItemTypeId.Value)
                    : null;
                var ni = new PurchaseItem
                {
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = itemType?.Name ?? "",
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    UOM = i.UOM ?? itemType?.UOM ?? "",
                    UnitPrice = i.UnitPrice,
                    LineTotal = Math.Round(i.Quantity * i.UnitPrice, 2),
                    HSCode = i.HSCode ?? itemType?.HSCode,
                    FbrUOMId = i.FbrUOMId ?? itemType?.FbrUOMId,
                    SaleType = i.SaleType ?? itemType?.SaleType,
                    RateId = i.RateId,
                    FixedNotifiedValueOrRetailPrice = i.FixedNotifiedValueOrRetailPrice,
                };
                newItems.Add(ni);
                bill.Items.Add(ni);
            }
            bill.Subtotal = newItems.Sum(x => x.LineTotal);
            bill.GSTAmount = Math.Round(bill.Subtotal * dto.GSTRate / 100m, 2);
            bill.GrandTotal = bill.Subtotal + bill.GSTAmount;
            bill.AmountInWords = NumberToWordsConverter.Convert(bill.GrandTotal);

            await _context.SaveChangesAsync();

            // Re-emit Stock IN for the new line set.
            foreach (var ni in newItems)
            {
                if (!ni.ItemTypeId.HasValue || ni.Quantity <= 0) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: ni.ItemTypeId.Value,
                    direction: StockMovementDirection.In,
                    quantity: ni.Quantity,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Purchase Bill #{bill.PurchaseBillNumber} (edited)");
            }

            return await GetByIdAsync(bill.Id);
        }

        public async Task<bool> DeleteAsync(int id)
        {
            var bill = await _context.PurchaseBills
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (bill == null) return false;

            // Reverse Stock IN before deleting the bill rows. Compensating
            // OUT entries are written rather than the original IN rows
            // being deleted — keeps the movement log immutable.
            foreach (var it in bill.Items)
            {
                if (!it.ItemTypeId.HasValue || it.Quantity <= 0) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: it.ItemTypeId.Value,
                    direction: StockMovementDirection.Out,
                    quantity: it.Quantity,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Reversal — Purchase Bill #{bill.PurchaseBillNumber} deleted");
            }

            _context.PurchaseBills.Remove(bill);
            await _context.SaveChangesAsync();
            return true;
        }

        public async Task<int> GetCountByCompanyAsync(int companyId) =>
            await _context.PurchaseBills.CountAsync(p => p.CompanyId == companyId);
    }
}
