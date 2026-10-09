using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class PurchaseDebitNoteService : IPurchaseDebitNoteService
    {
        private readonly AppDbContext _context;
        private readonly IStockService _stock;
        private readonly IGeneralLedgerService _gl;
        private readonly IPostingService _posting;
        private readonly ILogger<PurchaseDebitNoteService> _logger;

        public PurchaseDebitNoteService(
            AppDbContext context, IStockService stock, IPostingService posting, IGeneralLedgerService gl,
            ILogger<PurchaseDebitNoteService> logger)
        {
            _context = context;
            _gl = gl;
            _stock = stock;
            _posting = posting;
            _logger = logger;
        }

        private static PurchaseDebitNoteDto ToDto(Models.PurchaseDebitNote d) => new()
        {
            Id = d.Id,
            DebitNoteNumber = d.DebitNoteNumber,
            Date = d.Date,
            CompanyId = d.CompanyId,


            SupplierId = d.SupplierId,
            SupplierName = d.Supplier?.Name ?? "",
            SupplierRef = d.SupplierRef,
            Notes = d.Notes,
            Subtotal = d.Subtotal,
            GSTRate = d.GSTRate,
            GSTAmount = d.GSTAmount,
            GrandTotal = d.GrandTotal,
            Items = d.Items.OrderBy(i => i.Id).Select(i => new PurchaseDebitNoteItemDto
            {
                Id = i.Id,
                Description = i.Description,
                Quantity = i.Quantity,
                UOM = i.UOM,
                UnitPrice = i.UnitPrice,
                LineTotal = i.LineTotal,
                ItemTypeId = i.ItemTypeId,
                ItemTypeName = i.ItemTypeName,
                AccountId = i.AccountId,
                AccountName = i.Account?.Name,
                HSCode = i.HSCode,
            }).ToList(),
        };

        public async Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId)
        {
            var q = _context.PurchaseDebitNotes.AsNoTracking()
                .Include(d => d.Supplier)
                .Include(d => d.Items).ThenInclude(i => i.Account)
                .Where(d => d.CompanyId == companyId);
            var rows = await q.OrderByDescending(d => d.DebitNoteNumber).ToListAsync();
            return rows.Select(ToDto).ToList();
        }

        public async Task<PurchaseDebitNoteDto?> GetByIdAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.AsNoTracking()
                .Include(x => x.Supplier)
                .Include(x => x.Items).ThenInclude(i => i.Account)
                .FirstOrDefaultAsync(x => x.Id == id);
            return d == null ? null : ToDto(d);
        }

        public async Task<PrintPurchaseDebitNoteDto?> GetPrintDataAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.AsNoTracking()
                .Include(x => x.Company)

                .Include(x => x.Supplier)
                .Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (d == null) return null;
            var issuerName = (string.IsNullOrWhiteSpace(d.Company?.BrandName) ? d.Company?.Name : d.Company?.BrandName) ?? "";
            var gstRate = d.GSTRate != 0 ? d.GSTRate
                : (d.Subtotal != 0 ? Math.Round(d.GSTAmount / d.Subtotal * 100m, 2) : 0m);

            return new PrintPurchaseDebitNoteDto
            {
                SupplierName = issuerName,
                SupplierLogoPath = d.Company?.LogoPath,
                SupplierAddress = d.Company?.FullAddress,
                SupplierPhone = d.Company?.Phone,
                SupplierNTN = d.Company?.NTN,
                SupplierSTRN = d.Company?.STRN,

                CompanyBrandName = (string.IsNullOrWhiteSpace(d.Company?.BrandName) ? d.Company?.Name : d.Company?.BrandName) ?? "",
                CompanyLogoPath = d.Company?.LogoPath,
                CompanyAddress = d.Company?.FullAddress,
                CompanyPhone = d.Company?.Phone,
                CompanyNTN = d.Company?.NTN,
                CompanySTRN = d.Company?.STRN,







                BuyerName = d.Supplier?.Name ?? "",
                BuyerAddress = d.Supplier?.Address,
                BuyerPhone = d.Supplier?.Phone,
                BuyerNTN = d.Supplier?.NTN,
                BuyerSTRN = d.Supplier?.STRN,
                InvoiceNumber = d.DebitNoteNumber.ToString(),
                Date = d.Date,
                Subtotal = d.Subtotal,
                GstRate = gstRate,
                GstAmount = d.GSTAmount,
                GrandTotal = d.GrandTotal,
                AmountInWords = Helpers.NumberToWordsConverter.Convert(d.GrandTotal),
                OriginalInvoiceNumber = d.SupplierRef,
                NoteKindLabel = "Debit Note",
                Items = d.Items.OrderBy(i => i.Id).Select(i => new PrintPurchaseDebitNoteItemDto
                {
                    ItemTypeName = i.ItemTypeName,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Uom = i.UOM,
                    HsCode = i.HSCode,
                    ValueExclTax = i.LineTotal,
                    GstRate = 0m,
                    GstAmount = 0m,
                    TotalInclTax = i.LineTotal,
                }).ToList(),
            };
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            var q = _context.PurchaseDebitNotes.Where(d => d.CompanyId == companyId);
            return await q.CountAsync();
        }
        public async Task<PurchaseDebitNoteDto> CreateAsync(CreatePurchaseDebitNoteDto dto)
        {
            const int maxAttempts = NumberAllocationRetry.DefaultMaxAttempts;
            DbUpdateException? lastConflict = null;
            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                await using var tx = await _context.Database.BeginTransactionAsync();
                try
                {
                    var supplier = await _context.Suppliers
                        .FirstOrDefaultAsync(s => s.Id == dto.SupplierId && s.CompanyId == dto.CompanyId);
                    if (supplier == null) throw new KeyNotFoundException("Supplier not found.");
                    if (dto.Items == null || dto.Items.Count == 0)
                        throw new InvalidOperationException("At least one item is required.");
                    if (dto.Items.Any(i => i.Quantity <= 0))
                        throw new InvalidOperationException("Quantity must be greater than zero.");
                    if (dto.Items.Any(i => i.UnitPrice < 0))
                        throw new InvalidOperationException("Unit price cannot be negative.");
                    await _gl.AssertPeriodOpenAsync(dto.CompanyId, dto.Date);
                    var maxQuery = _context.PurchaseDebitNotes.Where(d => d.CompanyId == dto.CompanyId);
                    var nextNumber = (await maxQuery.Select(d => (int?)d.DebitNoteNumber).MaxAsync() ?? 0) + 1;

                    var items = await BuildItemsAsync(dto.CompanyId, dto.Items);
                    var subtotal = items.Sum(x => x.LineTotal);
                    var gstAmount = Math.Round(subtotal * dto.GSTRate / 100m, 2);
                    var grandTotal = subtotal + gstAmount;

                    var note = new Models.PurchaseDebitNote
                    {
                        DebitNoteNumber = nextNumber,
                        Date = dto.Date.Date,
                        CompanyId = dto.CompanyId,

                        SupplierId = dto.SupplierId,
                        SupplierRef = dto.SupplierRef?.Trim(),
                        Notes = dto.Notes?.Trim(),
                        Subtotal = subtotal,
                        GSTRate = dto.GSTRate,
                        GSTAmount = gstAmount,
                        GrandTotal = grandTotal,
                        Items = items,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _context.PurchaseDebitNotes.Add(note);
                    await _context.SaveChangesAsync();
                    await RecordStockOutAsync(note, items, supplier.Name);
                    await _posting.PostPurchaseDebitNoteAsync(note);

                    await tx.CommitAsync();
                    return (await GetByIdAsync(note.Id))!;
                }
                catch (DbUpdateException dupEx) when (NumberAllocationRetry.IsUniqueViolation(dupEx))
                {
                    lastConflict = dupEx;
                    _logger.LogWarning(
                        "Purchase debit note number collided with a concurrent create for company {CompanyId}; retrying (attempt {Attempt}).",
                        dto.CompanyId, attempt);
                    await tx.RollbackAsync();
                    foreach (var entry in _context.ChangeTracker.Entries().ToList())
                        if (entry.State != EntityState.Unchanged) entry.State = EntityState.Detached;
                    if (attempt < maxAttempts) await Task.Delay(10 * attempt);
                    continue;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "PurchaseDebitNoteService.CreateAsync: transaction rolled back");
                    await tx.RollbackAsync();
                    throw;
                }
            }
            throw new InvalidOperationException(
                "Could not allocate a unique debit note number after " + maxAttempts + " attempts. Please retry.", lastConflict);
        }
        public async Task<PurchaseDebitNoteDto?> UpdateAsync(int id, UpdatePurchaseDebitNoteDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var note = await _context.PurchaseDebitNotes
                    .Include(d => d.Items)
                    .FirstOrDefaultAsync(d => d.Id == id);
                if (note == null) return null;
                await _gl.AssertPeriodOpenAsync(note.CompanyId, note.Date);

                var supplier = await _context.Suppliers
                    .FirstOrDefaultAsync(s => s.Id == dto.SupplierId && s.CompanyId == note.CompanyId);
                if (supplier == null) throw new KeyNotFoundException("Supplier not found.");
                if (dto.Items == null || dto.Items.Count == 0)
                    throw new InvalidOperationException("At least one item is required.");
                if (dto.Items.Any(i => i.Quantity <= 0))
                    throw new InvalidOperationException("Quantity must be greater than zero.");
                if (dto.Items.Any(i => i.UnitPrice < 0))
                    throw new InvalidOperationException("Unit price cannot be negative.");

                if (dto.Date.HasValue) note.Date = dto.Date.Value.Date;
                await _gl.AssertPeriodOpenAsync(note.CompanyId, note.Date);
                note.SupplierId = dto.SupplierId;
                note.SupplierRef = dto.SupplierRef?.Trim();
                note.Notes = dto.Notes?.Trim();
                note.GSTRate = dto.GSTRate;
                _context.PurchaseDebitNoteItems.RemoveRange(note.Items);
                note.Items.Clear();
                var newItems = await BuildItemsAsync(note.CompanyId, dto.Items);
                foreach (var ni in newItems) note.Items.Add(ni);

                note.Subtotal = newItems.Sum(x => x.LineTotal);
                note.GSTAmount = Math.Round(note.Subtotal * dto.GSTRate / 100m, 2);
                note.GrandTotal = note.Subtotal + note.GSTAmount;
                await _context.SaveChangesAsync();
                await ReconcileStockToLinesAsync(note, newItems);
                await _posting.PostPurchaseDebitNoteAsync(note);

                await tx.CommitAsync();
                return await GetByIdAsync(note.Id);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PurchaseDebitNoteService.UpdateAsync: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }
        }
        public async Task<bool> DeleteAsync(int id)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var note = await _context.PurchaseDebitNotes
                    .Include(d => d.Items)
                    .FirstOrDefaultAsync(d => d.Id == id);
                if (note == null) return false;

                await _gl.AssertPeriodOpenAsync(note.CompanyId, note.Date);
                await ReverseStockAsync(note, note.Date, $"Reversal — Debit Note #{note.DebitNoteNumber} deleted");
                await _posting.RemoveForSourceAsync(note.CompanyId, SourceDocType.PurchaseDebitNote, note.Id);

                _context.PurchaseDebitNotes.Remove(note);   // items cascade
                await _context.SaveChangesAsync();
                await tx.CommitAsync();
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PurchaseDebitNoteService.DeleteAsync: transaction rolled back");
                await tx.RollbackAsync();
                throw;
            }
        }
        private async Task<List<Models.PurchaseDebitNoteItem>> BuildItemsAsync(
            int companyId, List<CreatePurchaseDebitNoteItemDto> lines)
        {
            var chosenItemTypeIds = lines.Where(i => i.ItemTypeId.HasValue)
                .Select(i => i.ItemTypeId!.Value).Distinct().ToList();
            var itemTypeMap = chosenItemTypeIds.Count == 0
                ? new Dictionary<int, ItemType>()
                : await _context.ItemTypes.Where(it => chosenItemTypeIds.Contains(it.Id) && it.CompanyId == companyId)
                    .ToDictionaryAsync(it => it.Id);
            if (chosenItemTypeIds.Any(cid => !itemTypeMap.ContainsKey(cid)))
                throw new InvalidOperationException("A selected item type was not found.");

            var validAccountIds = await ValidCompanyAccountIdsAsync(companyId, lines.Select(i => i.AccountId));

            var result = new List<Models.PurchaseDebitNoteItem>();
            foreach (var i in lines)
            {
                ItemType? itemType = i.ItemTypeId.HasValue ? itemTypeMap[i.ItemTypeId.Value] : null;
                result.Add(new Models.PurchaseDebitNoteItem
                {
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = itemType?.Name,
                    AccountId = Coerce(i.AccountId, validAccountIds),
                    Description = i.Description?.Trim() ?? "",
                    Quantity = i.Quantity,
                    UOM = i.UOM ?? itemType?.UOM,
                    UnitPrice = i.UnitPrice,
                    LineTotal = Math.Round(i.Quantity * i.UnitPrice, 2),
                    HSCode = i.HSCode ?? itemType?.HSCode,
                });
            }
            return result;
        }
        private async Task RecordStockOutAsync(Models.PurchaseDebitNote note, List<Models.PurchaseDebitNoteItem> items, string supplierName)
        {
            var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(
                items.Where(i => i.ItemTypeId.HasValue).Select(i => i.ItemTypeId!.Value));
            foreach (var it in items)
            {
                if (!it.ItemTypeId.HasValue || it.Quantity <= 0) continue;
                if (!tracked.Contains(it.ItemTypeId.Value)) continue;
                await _stock.RecordMovementAsync(
                    companyId: note.CompanyId,
                    itemTypeId: it.ItemTypeId.Value,
                    direction: StockMovementDirection.Out,
                    quantity: it.Quantity,
                    sourceType: StockMovementSourceType.PurchaseDebitNote,
                    sourceId: note.Id,
                    movementDate: note.Date,
                    notes: $"Debit Note #{note.DebitNoteNumber} — return to {supplierName}");
            }
        }
        private async Task ReconcileStockToLinesAsync(Models.PurchaseDebitNote note, List<Models.PurchaseDebitNoteItem> newItems)
        {
            var trackedNew = await _stock.GetStockTrackedItemTypeIdsAsync(
                newItems.Where(n => n.ItemTypeId.HasValue).Select(n => n.ItemTypeId!.Value));
            var desired = new Dictionary<int, decimal>();
            foreach (var ni in newItems)
            {
                if (!ni.ItemTypeId.HasValue || ni.Quantity <= 0) continue;
                if (!trackedNew.Contains(ni.ItemTypeId.Value)) continue;
                desired.TryGetValue(ni.ItemTypeId.Value, out var cur);
                desired[ni.ItemTypeId.Value] = cur + ni.Quantity;
            }
            var posted = (await _context.StockMovements
                    .Where(m => m.CompanyId == note.CompanyId
                             && m.SourceType == StockMovementSourceType.PurchaseDebitNote
                             && m.SourceId == note.Id)
                    .GroupBy(m => m.ItemTypeId)
                    .Select(g => new
                    {
                        ItemTypeId = g.Key,
                        Net = g.Sum(m => m.Direction == StockMovementDirection.Out ? m.Quantity : -m.Quantity),
                    })
                    .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.Net);

            foreach (var itemTypeId in desired.Keys.Union(posted.Keys))
            {
                desired.TryGetValue(itemTypeId, out var want);
                posted.TryGetValue(itemTypeId, out var have);
                var delta = want - have;
                if (delta == 0m) continue;
                await _stock.RecordMovementAsync(
                    companyId: note.CompanyId,
                    itemTypeId: itemTypeId,
                    direction: delta > 0m ? StockMovementDirection.Out : StockMovementDirection.In,
                    quantity: Math.Abs(delta),
                    sourceType: StockMovementSourceType.PurchaseDebitNote,
                    sourceId: note.Id,
                    movementDate: note.Date,
                    notes: $"Debit Note #{note.DebitNoteNumber} (edit — stock {(delta > 0m ? "decreased" : "restored")} by {Math.Abs(delta):0.####})");
            }
        }
        private async Task ReverseStockAsync(Models.PurchaseDebitNote note, DateTime movementDate, string notes)
        {
            var posted = await _context.StockMovements
                .Where(m => m.CompanyId == note.CompanyId
                         && m.SourceType == StockMovementSourceType.PurchaseDebitNote
                         && m.SourceId == note.Id)
                .GroupBy(m => m.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Net = g.Sum(m => m.Direction == StockMovementDirection.Out ? m.Quantity : -m.Quantity),
                })
                .ToListAsync();

            foreach (var p in posted)
            {
                if (p.Net <= 0m) continue;
                await _stock.RecordMovementAsync(
                    companyId: note.CompanyId,
                    itemTypeId: p.ItemTypeId,
                    direction: StockMovementDirection.In,
                    quantity: p.Net,
                    sourceType: StockMovementSourceType.PurchaseDebitNote,
                    sourceId: note.Id,
                    movementDate: movementDate,
                    notes: notes);
            }
        }
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
