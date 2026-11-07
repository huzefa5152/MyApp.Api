using Microsoft.EntityFrameworkCore;
using System.Data;
using Microsoft.Extensions.Logging;
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
        // Phase B: bill saves/deletes re-sync the bill's GL journal entry
        // (no-op unless the company enabled GL posting).
        private readonly IPostingService _posting;
        private readonly ILogger<PurchaseBillService> _logger;

        public PurchaseBillService(AppDbContext context, IStockService stock,
            IPostingService posting, ILogger<PurchaseBillService> logger)
        {
            _context = context;
            _stock = stock;
            _posting = posting;
            _logger = logger;
        }

        private static PurchaseBillDto ToDto(PurchaseBill pb) => new()
        {
            Id = pb.Id,
            CopiedFromType = pb.CopiedFromType,
            CopiedFromId = pb.CopiedFromId,
            PurchaseBillNumber = pb.PurchaseBillNumber,
            Date = pb.Date,
            CompanyId = pb.CompanyId,
            CompanyName = pb.Company?.Name ?? "",
            DivisionId = pb.DivisionId,
            DivisionName = pb.Division?.Name,
            SupplierId = pb.SupplierId,
            SourceDeliveryChallanId = pb.SourceDeliveryChallanId,
            SupplierName = pb.Supplier?.Name ?? "",
            SupplierBillNumber = pb.SupplierBillNumber,
            SupplierIRN = pb.SupplierIRN,
            Subtotal = pb.Subtotal,
            GSTRate = pb.GSTRate,
            GSTAmount = pb.GSTAmount,
            GrandTotal = pb.GrandTotal,
            AmountInWords = pb.AmountInWords,
            PaymentTerms = pb.PaymentTerms,
            Notes = pb.Notes,
            WithholdingTaxRate = pb.WithholdingTaxRate,
            WithholdingTaxAmount = pb.WithholdingTaxAmount,
            DueDate = pb.DueDate,
            AmountPaid = pb.AmountPaid,
            // Collectible = GrandTotal − WHT (what we owe the supplier after
            // withholding); balance due + status settle against it.
            BalanceDue = PaymentStatusCalculator.BalanceDue(WithholdingTaxCalculator.Collectible(pb.GrandTotal, pb.WithholdingTaxAmount), pb.AmountPaid),
            PaymentStatus = PaymentStatusCalculator.Status(WithholdingTaxCalculator.Collectible(pb.GrandTotal, pb.WithholdingTaxAmount), pb.AmountPaid, pb.DueDate).ToString(),
            DaysOverdue = PaymentStatusCalculator.DaysOverdue(WithholdingTaxCalculator.Collectible(pb.GrandTotal, pb.WithholdingTaxAmount), pb.AmountPaid, pb.DueDate),
            DocumentType = pb.DocumentType,
            PaymentMode = pb.PaymentMode,
            ReconciliationStatus = pb.ReconciliationStatus,
            CreatedAt = pb.CreatedAt,
            Items = pb.Items?.Select(i => new PurchaseItemDto
            {
                Id = i.Id,
                ItemTypeId = i.ItemTypeId,
                ItemTypeName = i.ItemType?.Name ?? i.ItemTypeName,
                NonInventoryItemId = i.NonInventoryItemId,
                NonInventoryItemName = i.NonInventoryItem?.Name,
                AccountId = i.AccountId,
                AccountName = i.Account?.Name,
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
                Sources = i.Sources?.Select(src => new PurchaseItemSourceDto
                {
                    Kind = src.SalesOrderItemId != null ? "order" : src.DeliveryItemId != null ? "challan" : "bill",
                    LineId = src.SalesOrderItemId ?? src.DeliveryItemId ?? src.InvoiceItemId ?? 0,
                    Quantity = src.Quantity,
                    TrailKey = TrailKey(src),
                }).ToList() ?? new(),
                Tags = SourceTags(i.Sources),
            }).ToList() ?? new(),
            ForDocuments = SourceTags(pb.Items?.SelectMany(i => i.Sources ?? new List<PurchaseItemSource>())),
            LinkedSaleBillNumbers = SaleBillNumbers(pb),
        };

        // The sale bills a purchase serves: bill lines it buys directly.
        private static List<int> SaleBillNumbers(PurchaseBill pb) =>
            pb.Items?.SelectMany(i => i.Sources ?? new List<PurchaseItemSource>())
                .Where(src => src.InvoiceItem?.Invoice != null)
                .Select(src => src.InvoiceItem!.Invoice.InvoiceNumber)
                .Distinct().OrderBy(n => n).ToList() ?? new();

        // The demand a source belongs to, keyed like CustomerDemand's trails: the
        // order line when the chain has one, else the challan line, else the bill line.
        private static string TrailKey(PurchaseItemSource src)
        {
            if (src.SalesOrderItemId is int o) return "o:" + o;
            var di = src.DeliveryItem ?? src.InvoiceItem?.DeliveryItem;
            if (di?.SalesOrderItemId is int dso) return "o:" + dso;
            if (di != null) return "c:" + di.Id;
            if (src.InvoiceItem?.SalesOrderItemId is int bso) return "o:" + bso;
            return "b:" + src.InvoiceItemId;
        }

        // The customer documents behind purchase sources, each once, orders first.
        private static List<DemandTagDto> SourceTags(IEnumerable<PurchaseItemSource>? sources) =>
            (sources ?? Enumerable.Empty<PurchaseItemSource>())
                .Select(src =>
                    src.SalesOrderItem?.SalesOrder is { } o ? new DemandTagDto { Kind = "order", DocumentId = o.Id, Number = o.SalesOrderNumber, ClientName = o.Client?.Name ?? "" }
                    : src.DeliveryItem?.DeliveryChallan is { } c ? new DemandTagDto { Kind = "challan", DocumentId = c.Id, Number = c.ChallanNumber, ClientName = c.Client?.Name ?? "" }
                    : src.InvoiceItem?.Invoice is { } b ? new DemandTagDto { Kind = "bill", DocumentId = b.Id, Number = b.InvoiceNumber, ClientName = b.Client?.Name ?? "" }
                    : null)
                .Where(t => t != null).Select(t => t!)
                .DistinctBy(t => (t.Kind, t.DocumentId))
                .OrderBy(t => t.Kind == "order" ? 0 : t.Kind == "challan" ? 1 : 2).ThenBy(t => t.Number)
                .ToList();

        // Cross-tenant link guard: any non-inventory item referenced on a line
        // must belong to this company. Throws on a foreign ref.
        private async Task ValidateNonInvItemsAsync(int companyId, IEnumerable<int?> ids)
        {
            var wanted = ids.Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
            if (wanted.Count == 0) return;
            var valid = await _context.NonInventoryItems.AsNoTracking()
                .Where(n => n.CompanyId == companyId && wanted.Contains(n.Id))
                .Select(n => n.Id).ToListAsync();
            if (wanted.Any(w => !valid.Contains(w)))
                throw new InvalidOperationException("A selected non-inventory item does not belong to this company.");
        }

        public async Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null, bool? fromChallan = null)
        {
            var q = _context.PurchaseBills
                .Include(pb => pb.Supplier)
                .Include(pb => pb.Items)
                    .ThenInclude(pi => pi.ItemType)
                .Include(pb => pb.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.SalesOrderItem!).ThenInclude(i => i.SalesOrder).ThenInclude(o => o.Client)
                .Include(pb => pb.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.DeliveryItem!).ThenInclude(i => i.DeliveryChallan).ThenInclude(c => c.Client)
                .Include(pb => pb.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.Invoice).ThenInclude(b => b.Client)
                .Include(pb => pb.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.DeliveryItem)
                .Include(pb => pb.Division)
                .Where(pb => pb.CompanyId == companyId);
            // Division-RBAC scope first (null = unrestricted); the operator's
            // explicit divisionId FILTER below is a view preference layered on
            // top — the controller asserts it against the same allowed set.
            if (allowedDivisionIds != null)
                q = q.Where(pb => pb.DivisionId == null || allowedDivisionIds.Contains(pb.DivisionId.Value));
            if (fromChallan.HasValue)
                q = q.Where(pb => (pb.SourceDeliveryChallanId.HasValue || pb.Items.Any(i => i.Sources.Any())) == fromChallan.Value);
            if (supplierId.HasValue)
                q = q.Where(pb => pb.SupplierId == supplierId.Value);
            if (divisionId.HasValue)
                q = q.Where(pb => pb.DivisionId == divisionId.Value);
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
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.SalesOrderItem!).ThenInclude(i => i.SalesOrder).ThenInclude(o => o.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.DeliveryItem!).ThenInclude(i => i.DeliveryChallan).ThenInclude(c => c.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.Invoice).ThenInclude(b => b.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.DeliveryItem)
                .Include(p => p.Division)
                .FirstOrDefaultAsync(p => p.Id == id);
            return pb == null ? null : ToDto(pb);
        }

        public async Task<PrintPurchaseBillDto?> GetPrintDataAsync(int id)
        {
            var pb = await _context.PurchaseBills
                .AsNoTracking()
                .Include(p => p.Company)
                .Include(p => p.Supplier)
                .Include(p => p.Items)
                    .ThenInclude(pi => pi.ItemType)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.SalesOrderItem!).ThenInclude(i => i.SalesOrder).ThenInclude(o => o.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.DeliveryItem!).ThenInclude(i => i.DeliveryChallan).ThenInclude(c => c.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.Invoice).ThenInclude(b => b.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.DeliveryItem)
                .Include(p => p.Division)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (pb == null) return null;

            var grNumbers = await _context.GoodsReceipts
                .AsNoTracking()
                .Where(g => g.PurchaseBillId == id)
                .OrderBy(g => g.GoodsReceiptNumber)
                .Select(g => g.GoodsReceiptNumber)
                .ToListAsync();

            var sNo = 0;
            return new PrintPurchaseBillDto
            {
                CompanyBrandName = pb.Company?.BrandName ?? pb.Company?.Name ?? "",
                CompanyLogoPath = pb.Company?.LogoPath,
                CompanyAddress = pb.Company?.FullAddress,
                CompanyPhone = pb.Company?.Phone,
                CompanyNTN = pb.Company?.NTN,
                CompanySTRN = pb.Company?.STRN,
                DivisionName = pb.Division?.Name,
                DivisionBrandName = pb.Division?.BrandName,
                DivisionLogoPath = pb.Division?.LogoPath,
                DivisionAddress = pb.Division?.FullAddress,
                DivisionPhone = pb.Division?.Phone,
                DivisionNTN = pb.Division?.NTN,
                DivisionSTRN = pb.Division?.STRN,
                DivisionEmail = pb.Division?.Email,
                SupplierName = pb.Supplier?.Name ?? "",
                SupplierAddress = pb.Supplier?.Address,
                SupplierPhone = pb.Supplier?.Phone,
                SupplierNTN = pb.Supplier?.NTN,
                SupplierSTRN = pb.Supplier?.STRN,
                PurchaseBillNumber = pb.PurchaseBillNumber,
                Date = pb.Date,
                SupplierBillNumber = pb.SupplierBillNumber,
                SupplierIRN = pb.SupplierIRN,
                PaymentTerms = pb.PaymentTerms,
                Notes = pb.Notes,
                DueDate = pb.DueDate,
                GoodsReceiptNumbers = grNumbers,
                LinkedSaleBillNumbers = SaleBillNumbers(pb),
                Subtotal = pb.Subtotal,
                GSTRate = pb.GSTRate,
                GSTAmount = pb.GSTAmount,
                // Whole-rupee display total in sync with the in-words line —
                // same print-only transformation as PrintBillDto.
                GrandTotal = NumberToWordsConverter.RoundForDisplay(pb.GrandTotal),
                AmountInWords = NumberToWordsConverter.Convert(pb.GrandTotal),
                WithholdingTaxRate = pb.WithholdingTaxRate,
                WithholdingTaxAmount = pb.WithholdingTaxAmount,
                BalanceDueAfterWht = WithholdingTaxCalculator.Collectible(pb.GrandTotal, pb.WithholdingTaxAmount),
                Items = pb.Items?.Select(i => new PrintPurchaseBillItemDto
                {
                    SNo = ++sNo,
                    ItemTypeName = i.ItemType?.Name ?? i.ItemTypeName,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    UOM = i.UOM,
                    UnitPrice = i.UnitPrice,
                    LineTotal = i.LineTotal,
                    HSCode = i.HSCode,
                }).ToList() ?? new(),
            };
        }

        public async Task<PurchaseBillDto?> SetDueDateAsync(int id, DateTime? dueDate)
        {
            var pb = await _context.PurchaseBills
                .Include(p => p.Company)
                .Include(p => p.Supplier)
                .Include(p => p.Items).ThenInclude(pi => pi.ItemType)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.SalesOrderItem!).ThenInclude(i => i.SalesOrder).ThenInclude(o => o.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.DeliveryItem!).ThenInclude(i => i.DeliveryChallan).ThenInclude(c => c.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.Invoice).ThenInclude(b => b.Client)
                .Include(p => p.Items).ThenInclude(pi => pi.Sources).ThenInclude(src => src.InvoiceItem!).ThenInclude(i => i.DeliveryItem)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (pb == null) return null;
            pb.DueDate = dueDate?.Date;
            await _context.SaveChangesAsync();
            return await GetByIdAsync(id);
        }

        public async Task<PurchaseBillDto> CreateAsync(CreatePurchaseBillDto dto)
        {
            // Audit C-8 (2026-05-13): wrap the create in a retry loop so
            // two concurrent saves can't both land the same
            // PurchaseBillNumber. The UNIQUE (CompanyId,
            // PurchaseBillNumber) index now catches concurrent collisions;
            // we recompute MAX(*)+1 and retry up to 3 times.
            const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
            DbUpdateException? lastConflict = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
            // Single transaction across number allocation, source-line
            // joins, sale-side back-fill and stock movements. The previous
            // version had three SaveChangesAsync calls — if the second
            // failed after the first committed, you got an orphaned bill
            // with no joins / no stock movements.
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
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

            var nextNumber = await CompanyDocumentNumbers.AllocateAsync(_context, dto.CompanyId, "purchase-bill", dto.CustomNumber, dto.DivisionId);

            var items = new List<PurchaseItem>();
            // Pre-load all chosen ItemTypes in one query.
            var chosenItemTypeIds = dto.Items
                .Where(i => i.ItemTypeId.HasValue)
                .Select(i => i.ItemTypeId!.Value)
                .Distinct()
                .ToList();
            var itemTypeMap = await _context.ItemTypes
                .Where(it => chosenItemTypeIds.Contains(it.Id))
                .ToDictionaryAsync(it => it.Id);

            await ValidateNonInvItemsAsync(dto.CompanyId, dto.Items.Select(i => i.NonInventoryItemId));
            // Each purchase-bill line must be classified — an Item Type OR a Non-Inventory item.
            if (dto.Items.Any(i => !i.ItemTypeId.HasValue && !i.NonInventoryItemId.HasValue))
                throw new InvalidOperationException(
                    "Every purchase-bill line must have an Item Type or a Non-Inventory item selected.");

            var validAccountIds = await ValidCompanyAccountIdsAsync(dto.CompanyId, dto.Items.Select(i => i.AccountId));
            for (int idx = 0; idx < dto.Items.Count; idx++)
            {
                var i = dto.Items[idx];
                // A non-inventory line (Freight/Discount) has no item type / HS / stock.
                bool isNonInv = i.NonInventoryItemId.HasValue;
                ItemType? itemType = (!isNonInv && i.ItemTypeId.HasValue)
                    ? itemTypeMap.GetValueOrDefault(i.ItemTypeId.Value)
                    : null;

                items.Add(new PurchaseItem
                {
                    ItemTypeId = isNonInv ? null : i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    AccountId = Coerce(i.AccountId, validAccountIds),
                    ItemTypeName = itemType?.Name ?? "",
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    UOM = i.UOM ?? itemType?.UOM ?? "",
                    UnitPrice = i.UnitPrice,
                    LineTotal = Math.Round(i.Quantity * i.UnitPrice, 2),
                    HSCode = isNonInv ? null : (i.HSCode ?? itemType?.HSCode),
                    FbrUOMId = isNonInv ? null : (i.FbrUOMId ?? itemType?.FbrUOMId),
                    SaleType = isNonInv ? null : (i.SaleType ?? itemType?.SaleType),
                    RateId = isNonInv ? null : i.RateId,
                    FixedNotifiedValueOrRetailPrice = isNonInv ? null : i.FixedNotifiedValueOrRetailPrice,
                });
            }

            await ApplySourcesAsync(dto.CompanyId, dto.SupplierId,
                items.Select((item, idx) => (item, (List<PurchaseItemSourceDto>?)dto.Items[idx].Sources)).ToList(), excludeBillId: null);

            var subtotal = items.Sum(x => x.LineTotal);
            var gstAmount = Math.Round(subtotal * dto.GSTRate / 100m, 2);
            var grandTotal = subtotal + gstAmount;

            var bill = new PurchaseBill
            {
                PurchaseBillNumber = nextNumber,
                Date = dto.Date.Date,
                CompanyId = dto.CompanyId,
                DivisionId = dto.DivisionId,
                SupplierId = dto.SupplierId,
                SupplierBillNumber = dto.SupplierBillNumber?.Trim(),
                SupplierIRN = dto.SupplierIRN?.Trim(),
                Subtotal = subtotal,
                GSTRate = dto.GSTRate,
                GSTAmount = gstAmount,
                GrandTotal = grandTotal,
                WithholdingTaxRate = dto.WithholdingTaxRate,
                WithholdingTaxAmount = WithholdingTaxCalculator.Resolve(dto.WithholdingTaxRate, grandTotal, dto.WithholdingTaxAmount),
                AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                PaymentTerms = dto.PaymentTerms,
                Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
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
            // 2026-05-13: skip lines whose ItemType has no HSCode —
            // un-classified ItemTypes live outside the stock-tracking
            // system. Symmetric with the OUT-side gate in
            // StockService.SyncInvoiceStockMovementsAsync.
            var trackedOnCreate = await _stock.GetStockTrackedItemTypeIdsAsync(
                bill.CompanyId,
                items.Where(i => i.ItemTypeId.HasValue).Select(i => i.ItemTypeId!.Value));
            foreach (var it in items)
            {
                if (!it.ItemTypeId.HasValue || it.Quantity <= 0) continue;
                if (!trackedOnCreate.Contains(it.ItemTypeId.Value)) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: it.ItemTypeId.Value,
                    direction: StockMovementDirection.In,
                    // 2026-05-12: IStockService now accepts decimal(18,4)
                    // (matches PurchaseItem precision). Fractional UOMs
                    // are preserved instead of being rounded to int.
                    quantity: it.Quantity,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Purchase Bill #{bill.PurchaseBillNumber} from {supplier.Name}",
                    divisionId: bill.DivisionId);
            }

            // GL posting (Dr Inventory/Purchases + Input tax / Cr AP) — same tx.
            await _posting.PostPurchaseBillAsync(bill);
            await tx.CommitAsync();
            return (await GetByIdAsync(bill.Id))!;
            }
            catch (DbUpdateException dupEx) when (NumberAllocationRetry.IsUniqueViolation(dupEx))
            {
                lastConflict = dupEx;
                _logger.LogWarning(
                    "Purchase bill number collided with a concurrent create for company {CompanyId}; retrying (attempt {Attempt}).",
                    dto.CompanyId, attempt);
                await tx.RollbackAsync();
                foreach (var entry in _context.ChangeTracker.Entries().ToList())
                {
                    if (entry.State != EntityState.Unchanged)
                        entry.State = EntityState.Detached;
                }
                if (attempt < maxAttempts)
                    await Task.Delay(10 * attempt);
                continue;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PurchaseBillService: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique purchase bill number after " + maxAttempts +
                " attempts. Please retry the request.", lastConflict);
        }

        private static string ChallanPurchaseRevision(DeliveryChallan challan) =>
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(new {
                    challan.Id, challan.Status, challan.DeliveryDate,
                    Items = challan.Items.OrderBy(i => i.Id).Select(i => new {
                        i.Id, i.Description, i.Quantity, i.Unit, i.SupplierId, i.ActualUnitCost, i.ItemTypeId, i.NonInventoryItemId
                    })
                }))));

        public async Task<ChallanPurchasePreviewDto> PreviewFromChallanAsync(int challanId)
        {
            var challan = await _context.DeliveryChallans.AsNoTracking()
                .Include(c => c.Items).ThenInclude(i => i.Supplier)
                .FirstOrDefaultAsync(c => c.Id == challanId && !c.IsDemo)
                ?? throw new KeyNotFoundException("Challan not found.");
            if (challan.Status == "Cancelled") throw new InvalidOperationException("Cannot purchase from a cancelled challan.");
            if (challan.Items.Count == 0 || challan.Items.Any(i => !i.SupplierId.HasValue || !i.ActualUnitCost.HasValue || i.ActualUnitCost < 0 || i.Quantity <= 0))
                throw new InvalidOperationException("Set a supplier and non-negative actual unit cost on every line first.");
            if (challan.Items.Any(i => i.Supplier == null || i.Supplier.CompanyId != challan.CompanyId))
                throw new InvalidOperationException("A supplier does not belong to this company.");
            // Bills already made from this challan: show them as they were made.
            var alreadyCreated = await _context.PurchaseBills.AnyAsync(p => p.SourceDeliveryChallanId == challan.Id);
            var left = alreadyCreated ? await MadeOnChallanAsync(challan) : await LeftOnChallanAsync(challan);
            if (left.Values.All(q => q <= 0))
                throw new InvalidOperationException("This challan has nothing left to purchase.");
            return new ChallanPurchasePreviewDto {
                ChallanId = challan.Id, ChallanNumber = challan.ChallanNumber,
                Revision = ChallanPurchaseRevision(challan),
                Date = (challan.DeliveryDate ?? DateTime.UtcNow).Date,
                TracksStock = true,
                AlreadyCreated = alreadyCreated,
                Suppliers = challan.Items.Where(i => left[i.Id] > 0).GroupBy(i => i.SupplierId!.Value).OrderBy(g => g.Key)
                    .Select(g => new ChallanSupplierPurchaseDto {
                        SupplierId = g.Key, SupplierName = g.First().Supplier!.Name,
                        Items = g.Select(i => new PurchaseItemDto {
                            Id = i.Id, Description = i.Description, Quantity = left[i.Id],
                            UOM = i.Unit, UnitPrice = i.ActualUnitCost!.Value,
                            LineTotal = Math.Round(left[i.Id] * i.ActualUnitCost.Value, 2)
                        }).ToList()
                    }).ToList()
            };
        }

        public async Task<List<PurchaseBillDto>> CreateFromChallanAsync(int challanId, CreateChallanPurchasesDto? request = null)
        {
            // Keep the whole supplier batch atomic. The source+supplier unique index
            // also makes a repeated confirmation safe after a lost HTTP response.
            await using var tx = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
            try
            {
                var challan = await _context.DeliveryChallans
                    .FromSqlInterpolated($"SELECT * FROM DeliveryChallans WITH (UPDLOCK, HOLDLOCK) WHERE Id = {challanId}")
                    .Include(c => c.Items)
                    .FirstOrDefaultAsync(c => c.Id == challanId && !c.IsDemo);
                if (challan == null) throw new KeyNotFoundException("Challan not found.");
                if (challan.Status == "Cancelled")
                    throw new InvalidOperationException("Cannot create purchase bills for a cancelled challan.");
                if (challan.Items.Count == 0 || challan.Items.Any(i => !i.SupplierId.HasValue || !i.ActualUnitCost.HasValue))
                    throw new InvalidOperationException("Set a supplier and actual unit cost on every challan line first.");
                if (challan.Items.Any(i => i.ActualUnitCost < 0))
                    throw new InvalidOperationException("Actual unit cost cannot be negative.");

                if (request != null && (request.Revision != ChallanPurchaseRevision(challan) || request.Date == default))
                    throw new InvalidOperationException("The challan changed or the bill date is missing. Refresh the preview before creating bills.");
                if (challan.Items.Any(i => i.Quantity <= 0))
                    throw new InvalidOperationException("Purchase quantities must be positive.");

                // Use the allocator's company lock before reading purchase gaps,
                // so different challans cannot deadlock while claiming bill numbers.
                var company = await _context.Companies
                    .FromSqlInterpolated($"SELECT * FROM Companies WITH (UPDLOCK, ROWLOCK) WHERE Id = {challan.CompanyId}")
                    .FirstOrDefaultAsync() ?? throw new KeyNotFoundException("Company not found.");
                var existing = await _context.PurchaseBills.AsNoTracking()
                    .Where(p => p.SourceDeliveryChallanId == challanId)
                    .Select(p => new { p.Id, p.SupplierId })
                    .ToListAsync();
                // A repeated confirmation replays the bills already made, so it is
                // checked against the whole challan, not what is left after them.
                var left = existing.Count > 0
                    ? await MadeOnChallanAsync(challan)
                    : await LeftOnChallanAsync(challan, lockTrails: true);
                var groups = challan.Items.Where(i => left[i.Id] > 0).GroupBy(i => i.SupplierId!.Value).OrderBy(g => g.Key).ToList();
                var supplierIds = groups.Select(g => g.Key).ToList();
                if (request != null && (request.Suppliers == null || request.Suppliers.Count != groups.Count || request.Suppliers.Any(s => s == null) ||
                    request.Suppliers.Select(s => s.SupplierId).Distinct().Count() != groups.Count ||
                    request.Suppliers.Any(s => !supplierIds.Contains(s.SupplierId) || s.GSTRate < 0 || s.GSTRate > 100 || Math.Round(s.GSTRate, 2) != s.GSTRate || s.SupplierBillNumber?.Length > 100)))
                    throw new InvalidOperationException("Review the suppliers and GST rates (0–100%) before creating bills.");

                var supplierMap = await _context.Suppliers
                    .Where(s => s.CompanyId == challan.CompanyId && supplierIds.Contains(s.Id))
                    .ToDictionaryAsync(s => s.Id);
                if (supplierMap.Count != groups.Count)
                    throw new InvalidOperationException("A line supplier does not belong to this company.");
                var itemTypeIds = challan.Items.Where(i => i.ItemTypeId.HasValue).Select(i => i.ItemTypeId!.Value).Distinct().ToList();
                var validItemTypes = await _context.ItemTypes
                    .Where(i => itemTypeIds.Contains(i.Id))
                    .ToDictionaryAsync(i => i.Id);
                if (validItemTypes.Count != itemTypeIds.Count)
                    throw new InvalidOperationException("A line item type does not belong to this company.");
                await ValidateNonInvItemsAsync(challan.CompanyId, challan.Items.Select(i => i.NonInventoryItemId));

                if (existing.Count == 0 && groups.Count == 0)
                    throw new InvalidOperationException("This challan has nothing left to purchase.");
                if (existing.Count > 0)
                {
                    if (existing.Count != groups.Count || existing.Any(p => !supplierIds.Contains(p.SupplierId)))
                        throw new InvalidOperationException("Purchase bills already exist for this challan. Review them before changing its suppliers.");
                    await tx.CommitAsync();
                    var previous = new List<PurchaseBillDto>();
                    foreach (var row in existing)
                        previous.Add((await GetByIdAsync(row.Id))!);
                    return previous;
                }

                var number = 0;
                var createdIds = new List<int>();
                foreach (var group in groups)
                {
                    number = await CompanyDocumentNumbers.AllocateAsync(_context, challan.CompanyId, "purchase-bill", divisionId: challan.DivisionId);
                    var lines = group.Select(i => new PurchaseItem
                    {
                        Sources = { new PurchaseItemSource { DeliveryItemId = i.Id, Quantity = left[i.Id] } },
                        ItemTypeId = i.ItemTypeId,
                        NonInventoryItemId = i.NonInventoryItemId,
                        ItemTypeName = i.ItemTypeId.HasValue ? validItemTypes[i.ItemTypeId.Value].Name : "",
                        Description = i.Description,
                        Quantity = left[i.Id],
                        UOM = i.Unit,
                        UnitPrice = i.ActualUnitCost!.Value,
                        LineTotal = Math.Round(left[i.Id] * i.ActualUnitCost.Value, 2),
                    }).ToList();
                    var total = lines.Sum(i => i.LineTotal);
                    var settings = request?.Suppliers.Single(s => s.SupplierId == group.Key);
                    var gstRate = settings?.GSTRate ?? 0m;
                    var gstAmount = Math.Round(total * gstRate / 100m, 2);
                    var grandTotal = total + gstAmount;
                    var bill = new PurchaseBill
                    {
                        CompanyId = challan.CompanyId,
                        DivisionId = challan.DivisionId,
                        SupplierId = group.Key,
                        SourceDeliveryChallanId = challan.Id,
                        Source = "delivery-challan",
                        PurchaseBillNumber = number,
                        Date = request?.Date.Date ?? (challan.DeliveryDate ?? DateTime.UtcNow).Date,
                        Subtotal = total,
                        GSTRate = gstRate,
                        GSTAmount = gstAmount,
                        GrandTotal = grandTotal,
                        SupplierBillNumber = settings?.SupplierBillNumber?.Trim(),
                        AmountInWords = NumberToWordsConverter.Convert(grandTotal),
                        ReconciliationStatus = "ManualOnly",
                        Items = lines,
                    };
                    _context.PurchaseBills.Add(bill);
                    await _context.SaveChangesAsync();
                    var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(
                        bill.CompanyId, lines.Where(i => i.ItemTypeId.HasValue).Select(i => i.ItemTypeId!.Value));
                    foreach (var line in lines.Where(i => i.ItemTypeId.HasValue && i.Quantity > 0 && tracked.Contains(i.ItemTypeId!.Value)))
                        await _stock.RecordMovementAsync(bill.CompanyId, line.ItemTypeId!.Value,
                            StockMovementDirection.In, line.Quantity, StockMovementSourceType.PurchaseBill,
                            bill.Id, bill.Date, $"Purchase Bill #{bill.PurchaseBillNumber} from {supplierMap[group.Key].Name}", bill.DivisionId);
                    await _posting.PostPurchaseBillAsync(bill);
                    createdIds.Add(bill.Id);
                }
                await tx.CommitAsync();
                var result = new List<PurchaseBillDto>();
                foreach (var id in createdIds)
                    result.Add((await GetByIdAsync(id))!);
                return result;
            }
            catch
            {
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
            var bill = await _context.PurchaseBills
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (bill == null) return null;

            await CompanyDocumentNumbers.RenumberAsync(_context, bill.CompanyId, "purchase-bill", bill.Id, bill.PurchaseBillNumber, dto.CustomNumber, bill.DivisionId);
            bill.PurchaseBillNumber = dto.CustomNumber ?? bill.PurchaseBillNumber;

            // Apply header changes
            if (dto.Date.HasValue) bill.Date = dto.Date.Value.Date;
            // Capture the old IRN BEFORE we overwrite it — the
            // reconciliation transition below needs to know whether the
            // IRN value actually changed (vs a no-op edit that touched
            // other fields).
            var oldIrn = bill.SupplierIRN?.Trim();
            var newIrn = dto.SupplierIRN?.Trim();

            bill.SupplierBillNumber = dto.SupplierBillNumber?.Trim();
            bill.SupplierIRN = newIrn;
            bill.GSTRate = dto.GSTRate;
            bill.WithholdingTaxRate = dto.WithholdingTaxRate;
            bill.WithholdingTaxAmount = dto.WithholdingTaxAmount;   // reflowed below from rate/amount mode
            bill.PaymentTerms = dto.PaymentTerms;
            bill.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
            bill.DocumentType = dto.DocumentType;
            bill.PaymentMode = dto.PaymentMode;
            // Reconciliation status transitions:
            //   • IRN cleared             → "ManualOnly" (downgrade — input
            //                               tax claim no longer eligible)
            //   • IRN newly added on a    → "Pending" (upgrade — eligible
            //     "ManualOnly" bill         once supplier files in IRIS)
            //   • IRN VALUE changed on a  → "Pending" (the previous
            //     "Matched" or "Disputed"   reconciliation no longer holds
            //     bill                      for the new IRN — IRIS reconcile
            //                               job needs to re-validate)
            //   • Otherwise               → keep current status
            var irnChanged = !string.Equals(oldIrn, newIrn, StringComparison.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(newIrn))
                bill.ReconciliationStatus = "ManualOnly";
            else if (bill.ReconciliationStatus == "ManualOnly")
                bill.ReconciliationStatus = "Pending";
            else if (irnChanged
                     && (bill.ReconciliationStatus == "Matched"
                         || bill.ReconciliationStatus == "Disputed"))
                bill.ReconciliationStatus = "Pending";

            await ValidateNonInvItemsAsync(bill.CompanyId, dto.Items.Select(i => i.NonInventoryItemId));

            // Replace items wholesale (simpler than a diff, fine for v1)
            _context.PurchaseItems.RemoveRange(bill.Items);
            bill.Items.Clear();

            var validAccountIds = await ValidCompanyAccountIdsAsync(bill.CompanyId, dto.Items.Select(i => i.AccountId));
            var newItems = new List<PurchaseItem>();
            foreach (var i in dto.Items)
            {
                bool isNonInv = i.NonInventoryItemId.HasValue;
                ItemType? itemType = (!isNonInv && i.ItemTypeId.HasValue)
                    ? await _context.ItemTypes.FindAsync(i.ItemTypeId.Value)
                    : null;
                var ni = new PurchaseItem
                {
                    ItemTypeId = isNonInv ? null : i.ItemTypeId,
                    NonInventoryItemId = i.NonInventoryItemId,
                    AccountId = Coerce(i.AccountId, validAccountIds),
                    ItemTypeName = itemType?.Name ?? "",
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    UOM = i.UOM ?? itemType?.UOM ?? "",
                    UnitPrice = i.UnitPrice,
                    LineTotal = Math.Round(i.Quantity * i.UnitPrice, 2),
                    HSCode = isNonInv ? null : (i.HSCode ?? itemType?.HSCode),
                    FbrUOMId = isNonInv ? null : (i.FbrUOMId ?? itemType?.FbrUOMId),
                    SaleType = isNonInv ? null : (i.SaleType ?? itemType?.SaleType),
                    RateId = isNonInv ? null : i.RateId,
                    FixedNotifiedValueOrRetailPrice = isNonInv ? null : i.FixedNotifiedValueOrRetailPrice,
                };
                newItems.Add(ni);
                bill.Items.Add(ni);
            }
            await ApplySourcesAsync(bill.CompanyId, bill.SupplierId,
                newItems.Select((item, idx) => (item, (List<PurchaseItemSourceDto>?)dto.Items[idx].Sources)).ToList(), excludeBillId: bill.Id);
            bill.Subtotal = newItems.Sum(x => x.LineTotal);
            bill.GSTAmount = Math.Round(bill.Subtotal * dto.GSTRate / 100m, 2);
            bill.GrandTotal = bill.Subtotal + bill.GSTAmount;
            bill.WithholdingTaxAmount = WithholdingTaxCalculator.Resolve(bill.WithholdingTaxRate, bill.GrandTotal, bill.WithholdingTaxAmount);
            bill.AmountInWords = NumberToWordsConverter.Convert(bill.GrandTotal);

            await _context.SaveChangesAsync();

            // Reconcile stock to the new line set by DELTA only: compare what
            // this bill already posted (per ItemType, from the ledger) with
            // what the new lines should post, and emit just the difference.
            // A no-op edit — or any edit that doesn't change a tracked item's
            // quantity/type — moves NO stock (fixes the phantom reversal+IN
            // churn that used to inflate Total In / Total Out on every save).
            // It also self-heals bills corrupted by older logic: a posted net
            // of 0 against a desired qty yields a single IN of that qty.
            await ReconcileStockToLinesAsync(bill, newItems);

            // GL re-post: totals changed → replace the bill's journal entry.
            await _posting.PostPurchaseBillAsync(bill);
            await tx.CommitAsync();
            return await GetByIdAsync(bill.Id);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PurchaseBillService: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }
        }

        /// <summary>
        /// Emits compensating OUT movements that reverse exactly what this
        /// purchase bill has actually posted to the stock ledger so far —
        /// its net (IN − OUT) per ItemType, read back from StockMovements —
        /// rather than synthesizing OUTs from the bill's current line set.
        ///
        /// Why net-from-ledger instead of from-lines: the HSCode tracking
        /// gate is evaluated at write time. A bill created against an
        /// unclassified ItemType records no IN; if that ItemType is later
        /// classified, reversing "the current lines" would fabricate an OUT
        /// for an IN that never existed. Reading the bill's own posted net
        /// is symmetric with whatever was recorded — and a bill already
        /// corrupted by the old logic has net 0, so this emits nothing and
        /// the caller's re-emit restores the correct on-hand (self-heal).
        ///
        /// No-op when inventory tracking is off (RecordMovementAsync gates
        /// on it) or when nothing net-positive is outstanding.
        /// </summary>
        /// <summary>
        /// Reconciles the bill's posted stock to its current line set by
        /// emitting only the per-ItemType DELTA (desired − posted). Desired is
        /// the net IN the tracked, classified lines should hold; posted is the
        /// bill's current net (IN − OUT) read from the ledger. Emits an IN for
        /// a positive delta, an OUT for a negative one, and nothing when they
        /// match — so an edit that leaves every tracked item's quantity/type
        /// unchanged records no movement at all.
        /// </summary>
        private async Task ReconcileStockToLinesAsync(PurchaseBill bill, List<PurchaseItem> newItems)
        {
            // Desired net IN per tracked ItemType from the new lines
            // (symmetric HSCode gate — un-classified ItemTypes don't move).
            var trackedNew = await _stock.GetStockTrackedItemTypeIdsAsync(
                bill.CompanyId,
                newItems.Where(n => n.ItemTypeId.HasValue).Select(n => n.ItemTypeId!.Value));
            var desired = new Dictionary<int, decimal>();
            foreach (var ni in newItems)
            {
                if (!ni.ItemTypeId.HasValue || ni.Quantity <= 0) continue;
                if (!trackedNew.Contains(ni.ItemTypeId.Value)) continue;
                desired.TryGetValue(ni.ItemTypeId.Value, out var cur);
                desired[ni.ItemTypeId.Value] = cur + ni.Quantity;
            }

            // Currently posted net per ItemType, read back from the ledger.
            var posted = (await _context.StockMovements
                    .Where(m => m.CompanyId == bill.CompanyId
                             && m.SourceType == StockMovementSourceType.PurchaseBill
                             && m.SourceId == bill.Id)
                    .GroupBy(m => m.ItemTypeId)
                    .Select(g => new
                    {
                        ItemTypeId = g.Key,
                        Net = g.Sum(m => m.Direction == StockMovementDirection.In ? m.Quantity : -m.Quantity),
                    })
                    .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.Net);

            // Emit only the difference.
            foreach (var itemTypeId in desired.Keys.Union(posted.Keys))
            {
                desired.TryGetValue(itemTypeId, out var want);
                posted.TryGetValue(itemTypeId, out var have);
                var delta = want - have;
                if (delta == 0m) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: itemTypeId,
                    direction: delta > 0m ? StockMovementDirection.In : StockMovementDirection.Out,
                    quantity: Math.Abs(delta),
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: bill.Date,
                    notes: $"Purchase Bill #{bill.PurchaseBillNumber} (edit — stock {(delta > 0m ? "increased" : "decreased")} by {Math.Abs(delta):0.####})",
                    divisionId: bill.DivisionId);
            }
        }

        private async Task ReversePostedStockAsync(PurchaseBill bill, DateTime movementDate, string notes)
        {
            var posted = await _context.StockMovements
                .Where(m => m.CompanyId == bill.CompanyId
                         && m.SourceType == StockMovementSourceType.PurchaseBill
                         && m.SourceId == bill.Id)
                .GroupBy(m => m.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Net = g.Sum(m => m.Direction == StockMovementDirection.In ? m.Quantity : -m.Quantity),
                })
                .ToListAsync();

            foreach (var p in posted)
            {
                if (p.Net <= 0m) continue;
                await _stock.RecordMovementAsync(
                    companyId: bill.CompanyId,
                    itemTypeId: p.ItemTypeId,
                    direction: StockMovementDirection.Out,
                    quantity: p.Net,
                    sourceType: StockMovementSourceType.PurchaseBill,
                    sourceId: bill.Id,
                    movementDate: movementDate,
                    notes: notes,
                    divisionId: bill.DivisionId);
            }
        }

        public async Task<bool> DeleteAsync(int id)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
            var bill = await _context.PurchaseBills
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (bill == null) return false;

            // Period-close guard: a locked bill can't be deleted.
            await _posting.AssertPeriodOpenAsync(bill.CompanyId, bill.Date);

            // Reverse the bill's actual posted stock before deleting its rows.
            // Compensating OUT entries are written rather than the IN rows
            // being deleted — keeps the movement log immutable. Reverses the
            // bill's own posted net (see ReversePostedStockAsync) so a bill
            // whose ItemType was classified after creation isn't over-reversed.
            await ReversePostedStockAsync(bill, bill.Date,
                $"Reversal — Purchase Bill #{bill.PurchaseBillNumber} deleted");

            // The ledger entry dies with its document.
            await _posting.RemoveForSourceAsync(bill.CompanyId,
                Models.Accounting.SourceDocType.PurchaseBill, bill.Id);

            _context.PurchaseBills.Remove(bill);
            await _context.SaveChangesAsync();
            await tx.CommitAsync();
            return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PurchaseBillService: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }
        }

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseBills.Where(p => p.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(p => p.DivisionId == null || allowedDivisionIds.Contains(p.DivisionId.Value));
            return await q.CountAsync();
        }

        // Purchase-bill count per supplier for a company — powers the clickable
        // "N purchase bills" chip on the Suppliers page. Single GROUP BY.
        public async Task<Dictionary<int, int>> GetCountsBySupplierAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseBills.Where(p => p.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(p => p.DivisionId == null || allowedDivisionIds.Contains(p.DivisionId.Value));
            return await q
                .GroupBy(p => p.SupplierId)
                .Select(g => new { SupplierId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.SupplierId, x => x.Count);
        }

        /// <summary>
        /// What is left to buy on each line of <paramref name="challan"/>, counted
        /// across its trails (an order line or sale bill line bought for the same
        /// demand counts too), never more than the line itself delivered.
        /// </summary>
        private async Task<Dictionary<int, decimal>> LeftOnChallanAsync(DeliveryChallan challan, bool lockTrails = false)
        {
            var demand = new CustomerDemand(_context);
            await demand.LoadAsync(challan.CompanyId);
            var refs = challan.Items.Select(i => new DemandRef(DemandKind.Challan, i.Id)).ToList();
            if (lockTrails) await demand.LockAsync(refs);
            await demand.LoadBoughtAsync(null);
            // Two lines of one challan can sit on the same trail (one order line
            // delivered in two rows): they share what that trail has left.
            var trailLeft = new Dictionary<DemandTrail, decimal>();
            var left = new Dictionary<int, decimal>();
            foreach (var i in challan.Items.OrderBy(i => i.Id))
            {
                var t = demand.TrailOf(new DemandRef(DemandKind.Challan, i.Id));
                if (t == null) { left[i.Id] = 0; continue; }
                var room = trailLeft.TryGetValue(t, out var r) ? r : Math.Max(0, t.Left);
                left[i.Id] = Math.Min(i.DeliveredQuantity ?? i.Quantity, room);
                trailLeft[t] = room - left[i.Id];
            }
            return left;
        }

        /// <summary>
        /// What the challan's own "Create purchase bills" already bought per line,
        /// so a repeated confirmation replays exactly those bills. A bill made
        /// before rows recorded their sources bought every line in full.
        /// </summary>
        private async Task<Dictionary<int, decimal>> MadeOnChallanAsync(DeliveryChallan challan)
        {
            var made = await _context.PurchaseItemSources.AsNoTracking()
                .Where(x => x.PurchaseItem.PurchaseBill.SourceDeliveryChallanId == challan.Id && x.DeliveryItemId != null)
                .GroupBy(x => x.DeliveryItemId!.Value)
                .Select(g => new { g.Key, Qty = g.Sum(x => x.Quantity) })
                .ToDictionaryAsync(x => x.Key, x => x.Qty);
            var legacy = made.Count == 0;
            return challan.Items.ToDictionary(i => i.Id,
                i => legacy ? i.DeliveredQuantity ?? i.Quantity : made.GetValueOrDefault(i.Id));
        }

        /// <summary>
        /// Records which customer-document lines each purchase row buys, after
        /// checking every line is this company's and live, a row's sources add up
        /// to its quantity, no trail sits on two rows, and no trail is bought past
        /// what it asks for. Trail roots are locked first, so two bills saved at
        /// once cannot both take the same remainder. Challan lines on a bought
        /// trail with no planned supplier or cost take this purchase's.
        /// </summary>
        private async Task ApplySourcesAsync(int companyId, int supplierId,
            List<(PurchaseItem Item, List<PurchaseItemSourceDto>? Sources)> rows, int? excludeBillId)
        {
            var linked = rows.Where(r => r.Sources is { Count: > 0 }).ToList();
            if (linked.Count == 0) return;
            var demand = new CustomerDemand(_context);
            await demand.LoadAsync(companyId);

            var claims = new List<(PurchaseItem Item, DemandRef Ref, decimal Qty, DemandTrail Trail)>();
            foreach (var (item, sources) in linked)
            {
                foreach (var src in sources!)
                {
                    var kind = CustomerDemand.ParseKind(src.Kind);
                    var r = kind == null ? null : new DemandRef(kind.Value, src.LineId);
                    var trail = r == null ? null : demand.TrailOf(r);
                    // One message for missing, foreign and cancelled lines: no cross-company oracle.
                    if (trail == null) throw new InvalidOperationException(SourceNotFound);
                    if (src.Quantity <= 0)
                        throw new InvalidOperationException("A quantity taken from a customer document must be greater than zero.");
                    claims.Add((item, r!, src.Quantity, trail));
                }
                if (Math.Abs(sources!.Sum(x => x.Quantity) - item.Quantity) > 0.0001m)
                    throw new InvalidOperationException("The quantities taken from customer documents must add up to the row's quantity.");
            }

            var twice = claims.GroupBy(c => c.Trail).FirstOrDefault(g => g.Select(c => c.Item).Distinct().Count() > 1);
            if (twice != null)
                throw new InvalidOperationException($"\"{twice.Key.Latest.Description}\" is on this bill twice for the same customer line. Put it on one row.");

            await demand.LockAsync(claims.Select(c => c.Ref));
            await demand.LoadBoughtAsync(excludeBillId);
            foreach (var g in claims.GroupBy(c => c.Trail))
            {
                var t = g.Key;
                if (g.Sum(c => c.Qty) > t.Left + 0.0001m)
                    throw new InvalidOperationException(t.Left <= 0
                        ? $"{t.Path}: \"{t.Latest.Description}\" is already fully purchased."
                        : $"{t.Path}: only {t.Left:0.####} {t.Latest.Unit} of \"{t.Latest.Description}\" left to buy.");
            }

            foreach (var c in claims)
                c.Item.Sources.Add(new PurchaseItemSource
                {
                    SalesOrderItemId = c.Ref.Kind == DemandKind.Order ? c.Ref.LineId : null,
                    DeliveryItemId = c.Ref.Kind == DemandKind.Challan ? c.Ref.LineId : null,
                    InvoiceItemId = c.Ref.Kind == DemandKind.Bill ? c.Ref.LineId : null,
                    Quantity = c.Qty,
                });

            var priceByChallanLine = claims
                .SelectMany(c => c.Trail.Challans.Select(l => (l.Id, c.Item.UnitPrice)))
                .GroupBy(x => x.Id).ToDictionary(g => g.Key, g => g.First().UnitPrice);
            var challanIds = priceByChallanLine.Keys.ToList();
            foreach (var line in await _context.DeliveryItems
                         .Where(d => challanIds.Contains(d.Id) && (d.SupplierId == null || d.ActualUnitCost == null)).ToListAsync())
            {
                line.SupplierId ??= supplierId;
                line.ActualUnitCost ??= priceByChallanLine[line.Id];
            }
        }

        private const string SourceNotFound = "A customer document line on this bill was not found.";

        /// <summary>
        /// Customer-document lines still to buy for the purchase picker, grouped
        /// into cards. Only the document kinds the caller may view are returned.
        /// </summary>
        public async Task<List<AwaitingCardDto>> GetAwaitingLinesAsync(int companyId, AwaitingLinesQuery query,
            HashSet<int>? allowedDivisionIds, ISet<DemandKind> viewableKinds)
        {
            if (query.ExcludeBillId is int billId
                && !await _context.PurchaseBills.AnyAsync(p => p.Id == billId && p.CompanyId == companyId))
                throw new KeyNotFoundException("Purchase bill not found.");
            var demand = new CustomerDemand(_context);
            await demand.LoadAsync(companyId);
            await demand.LoadBoughtAsync(query.ExcludeBillId);
            return demand.AwaitingCards(query, allowedDivisionIds, viewableKinds);
        }

        /// <summary>Divisions of the documents behind the given source lines (null = company-level).</summary>
        public async Task<List<int?>> SourceDivisionsAsync(int companyId, IEnumerable<PurchaseItemSourceDto> sources)
        {
            var refs = sources.Select(s => (Kind: CustomerDemand.ParseKind(s.Kind), s.LineId)).Where(x => x.Kind != null).ToList();
            if (refs.Count == 0) return new();
            var demand = new CustomerDemand(_context);
            await demand.LoadAsync(companyId);
            return refs.Select(x => demand.TrailOf(new DemandRef(x.Kind!.Value, x.LineId))?.Members
                    .FirstOrDefault(m => m.Kind == x.Kind && m.Id == x.LineId)?.Doc.DivisionId)
                .Distinct().ToList();
        }

        /// <summary>Subset of <paramref name="candidates"/> that are ACTIVE accounts
        /// of the company's CoA — validates per-line AccountId overrides (design
        /// §3.3) so a foreign/inactive id is never persisted. Non-members are
        /// coerced to null by <see cref="Coerce"/> (engine derives the account).</summary>
        private async Task<HashSet<int>> ValidCompanyAccountIdsAsync(int companyId, IEnumerable<int?> candidates)
        {
            var ids = candidates.Where(x => x is > 0).Select(x => x!.Value).Distinct().ToList();
            if (ids.Count == 0) return new HashSet<int>();
            return (await _context.Accounts.AsNoTracking()
                .Where(a => a.CompanyId == companyId && a.IsActive && ids.Contains(a.Id))
                .Select(a => a.Id).ToListAsync()).ToHashSet();
        }

        private static int? Coerce(int? candidate, HashSet<int> validIds)
            => candidate is int id && validIds.Contains(id) ? id : null;
    }
}
