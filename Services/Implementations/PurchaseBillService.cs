using Microsoft.EntityFrameworkCore;
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
            PurchaseBillNumber = pb.PurchaseBillNumber,
            Date = pb.Date,
            CompanyId = pb.CompanyId,
            CompanyName = pb.Company?.Name ?? "",
            DivisionId = pb.DivisionId,
            DivisionName = pb.Division?.Name,
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
            DueDate = pb.DueDate,
            AmountPaid = pb.AmountPaid,
            BalanceDue = PaymentStatusCalculator.BalanceDue(pb.GrandTotal, pb.AmountPaid),
            PaymentStatus = PaymentStatusCalculator.Status(pb.GrandTotal, pb.AmountPaid, pb.DueDate).ToString(),
            DaysOverdue = PaymentStatusCalculator.DaysOverdue(pb.GrandTotal, pb.AmountPaid, pb.DueDate),
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
                SourceInvoiceItemIds = i.SourceLines?.Select(s => s.InvoiceItemId).ToList() ?? new(),
            }).ToList() ?? new(),
            // Distinct sale-bill numbers this purchase covered — computed
            // by walking the SourceLines → InvoiceItem → Invoice chain.
            LinkedSaleBillNumbers = pb.Items?
                .SelectMany(i => i.SourceLines ?? new List<PurchaseItemSourceLine>())
                .Where(sl => sl.InvoiceItem?.Invoice != null)
                .Select(sl => sl.InvoiceItem!.Invoice!.InvoiceNumber)
                .Distinct()
                .OrderBy(n => n)
                .ToList() ?? new(),
        };

        public async Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseBills
                .Include(pb => pb.Supplier)
                .Include(pb => pb.Items)
                    .ThenInclude(pi => pi.ItemType)
                .Include(pb => pb.Items)
                    .ThenInclude(pi => pi.SourceLines)
                        .ThenInclude(sl => sl.InvoiceItem!)
                            .ThenInclude(ii => ii.Invoice)
                .Include(pb => pb.Division)
                .Where(pb => pb.CompanyId == companyId);
            // Division-RBAC scope first (null = unrestricted); the operator's
            // explicit divisionId FILTER below is a view preference layered on
            // top — the controller asserts it against the same allowed set.
            if (allowedDivisionIds != null)
                q = q.Where(pb => pb.DivisionId == null || allowedDivisionIds.Contains(pb.DivisionId.Value));
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
                .Include(p => p.Items)
                    .ThenInclude(pi => pi.SourceLines)
                        .ThenInclude(sl => sl.InvoiceItem!)
                            .ThenInclude(ii => ii.Invoice)
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
                .Include(p => p.Items)
                    .ThenInclude(pi => pi.SourceLines)
                        .ThenInclude(sl => sl.InvoiceItem!)
                            .ThenInclude(ii => ii.Invoice)
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
                DueDate = pb.DueDate,
                GoodsReceiptNumbers = grNumbers,
                LinkedSaleBillNumbers = pb.Items?
                    .SelectMany(i => i.SourceLines ?? new List<PurchaseItemSourceLine>())
                    .Where(sl => sl.InvoiceItem?.Invoice != null)
                    .Select(sl => sl.InvoiceItem!.Invoice!.InvoiceNumber)
                    .Distinct()
                    .OrderBy(n => n)
                    .ToList() ?? new(),
                Subtotal = pb.Subtotal,
                GSTRate = pb.GSTRate,
                GSTAmount = pb.GSTAmount,
                // Whole-rupee display total in sync with the in-words line —
                // same print-only transformation as PrintBillDto.
                GrandTotal = NumberToWordsConverter.RoundForDisplay(pb.GrandTotal),
                AmountInWords = NumberToWordsConverter.Convert(pb.GrandTotal),
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
                .Include(p => p.Items).ThenInclude(pi => pi.SourceLines)
                    .ThenInclude(sl => sl.InvoiceItem!).ThenInclude(ii => ii.Invoice)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (pb == null) return null;
            pb.DueDate = dueDate?.Date;
            await _context.SaveChangesAsync();
            return ToDto(pb);
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

            // Allocate next purchase-bill number — independent of the sales-side
            // sequence, and scoped per division when the bill is tagged with one.
            var division = await MyApp.Api.Helpers.DivisionNumbering.ResolveAsync(_context, dto.CompanyId, dto.DivisionId);
            var maxQuery = _context.PurchaseBills.Where(p => p.CompanyId == dto.CompanyId);
            maxQuery = dto.DivisionId.HasValue
                ? maxQuery.Where(p => p.DivisionId == dto.DivisionId.Value)
                : maxQuery.Where(p => p.DivisionId == null);
            var maxNumber = await maxQuery.Select(p => (int?)p.PurchaseBillNumber).MaxAsync() ?? 0;
            var seed = division != null ? division.StartingPurchaseBillNumber : company.StartingPurchaseBillNumber;
            var nextNumber = MyApp.Api.Helpers.DivisionNumbering.Next(maxNumber, seed);
            if (division != null) division.CurrentPurchaseBillNumber = nextNumber;
            else company.CurrentPurchaseBillNumber = nextNumber;

            // Validate "Purchase Against Sale Bill" lines BEFORE we touch
            // anything. Any line with SourceInvoiceItemIds:
            //   • must carry an ItemTypeId (we group sale lines by it)
            //   • that catalog row MUST have a non-empty HSCode (the
            //     procurement flow exists precisely to set HSCode on
            //     unclassified sale lines)
            //   • every linked InvoiceItem must belong to an Invoice in
            //     this same Company (no cross-tenant linking)
            var lineErrors = new List<string>();
            var allSourceItemIds = dto.Items
                .SelectMany(x => x.SourceInvoiceItemIds ?? new())
                .Distinct()
                .ToList();
            Dictionary<int, InvoiceItem>? sourceLines = null;
            if (allSourceItemIds.Count > 0)
            {
                sourceLines = await _context.InvoiceItems
                    .Include(ii => ii.Invoice)
                    .Where(ii => allSourceItemIds.Contains(ii.Id))
                    .ToDictionaryAsync(ii => ii.Id);
                foreach (var (id, ii) in sourceLines)
                {
                    if (ii.Invoice.CompanyId != dto.CompanyId)
                        lineErrors.Add($"Sale line #{id} belongs to a different company.");
                }
            }
            for (int idx = 0; idx < dto.Items.Count; idx++)
            {
                var line = dto.Items[idx];
                if (line.SourceInvoiceItemIds == null || line.SourceInvoiceItemIds.Count == 0)
                    continue;
                if (!line.ItemTypeId.HasValue)
                    lineErrors.Add($"Line {idx + 1}: Item Type is required when procuring against a sale bill.");
            }
            if (lineErrors.Count > 0)
                throw new InvalidOperationException(string.Join("\n", lineErrors));

            var items = new List<PurchaseItem>();
            // Pre-load all chosen ItemTypes in one query so the HSCode
            // gate on against-sale lines runs without N round-trips.
            var chosenItemTypeIds = dto.Items
                .Where(i => i.ItemTypeId.HasValue)
                .Select(i => i.ItemTypeId!.Value)
                .Distinct()
                .ToList();
            var itemTypeMap = await _context.ItemTypes
                .Where(it => chosenItemTypeIds.Contains(it.Id))
                .ToDictionaryAsync(it => it.Id);

            for (int idx = 0; idx < dto.Items.Count; idx++)
            {
                var i = dto.Items[idx];
                ItemType? itemType = i.ItemTypeId.HasValue
                    ? itemTypeMap.GetValueOrDefault(i.ItemTypeId.Value)
                    : null;

                // HSCode gate for procurement-against-sale lines
                bool isAgainstSale = (i.SourceInvoiceItemIds?.Count ?? 0) > 0;
                if (isAgainstSale && string.IsNullOrWhiteSpace(itemType?.HSCode))
                {
                    throw new InvalidOperationException(
                        $"Line {idx + 1}: pick an Item Type WITH HS Code — procurement against a sale bill must be FBR-compliant.");
                }

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
                DivisionId = dto.DivisionId,
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

            // ── Source-line links + back-fill onto sale lines ─────────────
            // For each purchase row that points at a group of InvoiceItems,
            // write join rows AND apply the picked ItemType's HSCode/UOM/
            // SaleType/FbrUOMId onto every linked sale line in one shot.
            // This is the whole reason the flow exists: classify the sale
            // by classifying the procurement.
            for (int idx = 0; idx < dto.Items.Count; idx++)
            {
                var dtoLine = dto.Items[idx];
                var savedItem = items[idx];
                var sourceIds = dtoLine.SourceInvoiceItemIds;
                if (sourceIds == null || sourceIds.Count == 0) continue;
                if (sourceLines == null) continue;
                if (!savedItem.ItemTypeId.HasValue) continue;
                var catalog = itemTypeMap.GetValueOrDefault(savedItem.ItemTypeId.Value);
                if (catalog == null) continue;

                foreach (var srcId in sourceIds)
                {
                    if (!sourceLines.TryGetValue(srcId, out var src)) continue;

                    // Join row
                    _context.PurchaseItemSourceLines.Add(new PurchaseItemSourceLine
                    {
                        PurchaseItemId = savedItem.Id,
                        InvoiceItemId = src.Id,
                    });

                    // Back-fill — only fields the procurement is meant to
                    // populate. Don't touch quantity / unitPrice / description
                    // (those reflect the sale, not the procurement).
                    src.ItemTypeId = catalog.Id;
                    src.ItemTypeName = catalog.Name;
                    if (!string.IsNullOrWhiteSpace(catalog.HSCode)) src.HSCode = catalog.HSCode;
                    if (!string.IsNullOrWhiteSpace(catalog.UOM)) src.UOM = catalog.UOM;
                    if (catalog.FbrUOMId.HasValue) src.FbrUOMId = catalog.FbrUOMId;
                    if (!string.IsNullOrWhiteSpace(catalog.SaleType)) src.SaleType = catalog.SaleType;
                }
            }
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

        public async Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
            var bill = await _context.PurchaseBills
                .Include(p => p.Items)
                .FirstOrDefaultAsync(p => p.Id == id);
            if (bill == null) return null;

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
            bill.PaymentTerms = dto.PaymentTerms;
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
    }
}
