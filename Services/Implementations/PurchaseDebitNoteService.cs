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
        private readonly IPostingService _posting;
        private readonly ILogger<PurchaseDebitNoteService> _logger;

        public PurchaseDebitNoteService(
            AppDbContext context, IStockService stock, IPostingService posting,
            ILogger<PurchaseDebitNoteService> logger)
        {
            _context = context;
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
            DivisionId = d.DivisionId,
            DivisionName = d.Division?.Name,
            SupplierId = d.SupplierId,
            SupplierName = d.Supplier?.Name ?? "",
            SupplierRef = d.SupplierRef,
            Notes = d.Notes,
            Subtotal = d.Subtotal,
            GSTRate = d.GSTRate,
            GSTAmount = d.GSTAmount,
            GrandTotal = d.GrandTotal,
            IsMigrated = d.IsMigrated,
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

        public async Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseDebitNotes.AsNoTracking()
                .Include(d => d.Supplier).Include(d => d.Division)
                .Include(d => d.Items).ThenInclude(i => i.Account)
                .Where(d => d.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(d => d.DivisionId == null || allowedDivisionIds.Contains(d.DivisionId.Value));
            var rows = await q.OrderByDescending(d => d.DebitNoteNumber).ToListAsync();
            return rows.Select(ToDto).ToList();
        }

        public async Task<PurchaseDebitNoteDto?> GetByIdAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.AsNoTracking()
                .Include(x => x.Supplier).Include(x => x.Division)
                .Include(x => x.Items).ThenInclude(i => i.Account)
                .FirstOrDefaultAsync(x => x.Id == id);
            return d == null ? null : ToDto(d);
        }

        public async Task<PrintPurchaseDebitNoteDto?> GetPrintDataAsync(int id)
        {
            var d = await _context.PurchaseDebitNotes.AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.Division)
                .Include(x => x.Supplier)
                .Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (d == null) return null;

            // Issuer letterhead = the division when the note is division-tagged,
            // otherwise the company — matches how the other print docs resolve it.
            var issuerName = d.Division?.BrandName ?? d.Division?.Name
                ?? d.Company?.BrandName ?? d.Company?.Name ?? "";
            var gstRate = d.GSTRate != 0 ? d.GSTRate
                : (d.Subtotal != 0 ? Math.Round(d.GSTAmount / d.Subtotal * 100m, 2) : 0m);

            return new PrintPurchaseDebitNoteDto
            {
                SupplierName = issuerName,
                SupplierLogoPath = d.Division?.LogoPath ?? d.Company?.LogoPath,
                SupplierAddress = d.Division?.FullAddress ?? d.Company?.FullAddress,
                SupplierPhone = d.Division?.Phone ?? d.Company?.Phone,
                SupplierNTN = d.Division?.NTN ?? d.Company?.NTN,
                SupplierSTRN = d.Division?.STRN ?? d.Company?.STRN,
                // Same issuer under the company*/division* token names so a
                // DebitNote template that prints the letterhead via {{companyLogoPath}}
                // / {{divisionLogoPath}} (not {{supplierLogoPath}}) still shows the logo.
                DivisionId = d.DivisionId,
                CompanyBrandName = (string.IsNullOrWhiteSpace(d.Company?.BrandName) ? d.Company?.Name : d.Company?.BrandName) ?? "",
                CompanyLogoPath = d.Company?.LogoPath,
                CompanyAddress = d.Company?.FullAddress,
                CompanyPhone = d.Company?.Phone,
                CompanyNTN = d.Company?.NTN,
                CompanySTRN = d.Company?.STRN,
                DivisionName = d.Division?.Name,
                DivisionBrandName = d.Division?.BrandName,
                DivisionLogoPath = d.Division?.LogoPath,
                DivisionAddress = d.Division?.FullAddress,
                DivisionPhone = d.Division?.Phone,
                DivisionNTN = d.Division?.NTN,
                DivisionSTRN = d.Division?.STRN,
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

        public async Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null)
        {
            var q = _context.PurchaseDebitNotes.Where(d => d.CompanyId == companyId);
            if (allowedDivisionIds != null)
                q = q.Where(d => d.DivisionId == null || allowedDivisionIds.Contains(d.DivisionId.Value));
            return await q.CountAsync();
        }

        // ── Create ──────────────────────────────────────────────────────────────
        public async Task<PurchaseDebitNoteDto> CreateAsync(CreatePurchaseDebitNoteDto dto)
        {
            // Retry the whole transaction on a number collision, exactly like the
            // purchase-bill create — the (CompanyId, DivisionId, DebitNoteNumber)
            // unique index catches concurrent races; recompute MAX+1 and retry.
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

                    // Period-close guard (no-op when GL off).
                    await _posting.AssertPeriodOpenAsync(dto.CompanyId, dto.Date);

                    // Next number: MAX+1 scoped by (company, division). No dedicated
                    // Company/Division cursor — the sales-side CurrentDebitNoteNumber
                    // is a different sequence and must not be reused.
                    var maxQuery = _context.PurchaseDebitNotes.Where(d => d.CompanyId == dto.CompanyId);
                    maxQuery = dto.DivisionId.HasValue
                        ? maxQuery.Where(d => d.DivisionId == dto.DivisionId.Value)
                        : maxQuery.Where(d => d.DivisionId == null);
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
                        DivisionId = dto.DivisionId,
                        SupplierId = dto.SupplierId,
                        SupplierRef = dto.SupplierRef?.Trim(),
                        Notes = dto.Notes?.Trim(),
                        Subtotal = subtotal,
                        GSTRate = dto.GSTRate,
                        GSTAmount = gstAmount,
                        GrandTotal = grandTotal,
                        IsMigrated = false,
                        Items = items,
                        CreatedAt = DateTime.UtcNow,
                    };
                    _context.PurchaseDebitNotes.Add(note);
                    await _context.SaveChangesAsync();

                    // Stock OUT — goods returned to the supplier reduce on-hand.
                    await RecordStockOutAsync(note, items, supplier.Name);

                    // GL: Dr AP / Cr inventory-or-account / Cr input tax (same tx).
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

        // ── Update ──────────────────────────────────────────────────────────────
        public async Task<PurchaseDebitNoteDto?> UpdateAsync(int id, UpdatePurchaseDebitNoteDto dto)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var note = await _context.PurchaseDebitNotes
                    .Include(d => d.Items)
                    .FirstOrDefaultAsync(d => d.Id == id);
                if (note == null) return null;

                // Guard the note's current period before mutating it.
                await _posting.AssertPeriodOpenAsync(note.CompanyId, note.Date);

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
                note.SupplierId = dto.SupplierId;
                note.SupplierRef = dto.SupplierRef?.Trim();
                note.Notes = dto.Notes?.Trim();
                note.GSTRate = dto.GSTRate;

                // Replace lines wholesale (matches the purchase-bill update path).
                _context.PurchaseDebitNoteItems.RemoveRange(note.Items);
                note.Items.Clear();
                var newItems = await BuildItemsAsync(note.CompanyId, dto.Items);
                foreach (var ni in newItems) note.Items.Add(ni);

                note.Subtotal = newItems.Sum(x => x.LineTotal);
                note.GSTAmount = Math.Round(note.Subtotal * dto.GSTRate / 100m, 2);
                note.GrandTotal = note.Subtotal + note.GSTAmount;
                await _context.SaveChangesAsync();

                // Reconcile stock by DELTA only (OUT semantics), then re-post GL.
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

        // ── Delete ──────────────────────────────────────────────────────────────
        public async Task<bool> DeleteAsync(int id)
        {
            await using var tx = await _context.Database.BeginTransactionAsync();
            try
            {
                var note = await _context.PurchaseDebitNotes
                    .Include(d => d.Items)
                    .FirstOrDefaultAsync(d => d.Id == id);
                if (note == null) return false;

                await _posting.AssertPeriodOpenAsync(note.CompanyId, note.Date);

                // Reverse the note's actual posted stock (compensating IN) before
                // removing its rows — keeps the movement log immutable.
                await ReverseStockAsync(note, note.Date, $"Reversal — Debit Note #{note.DebitNoteNumber} deleted");

                // The ledger entry dies with its document.
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

        // ── Helpers ──────────────────────────────────────────────────────────────

        /// <summary>Materialize DTO lines into entity lines: coerce per-line
        /// AccountId to a real active company account, resolve item-type name/UOM/
        /// HSCode, and compute LineTotal.</summary>
        private async Task<List<Models.PurchaseDebitNoteItem>> BuildItemsAsync(
            int companyId, List<CreatePurchaseDebitNoteItemDto> lines)
        {
            var chosenItemTypeIds = lines.Where(i => i.ItemTypeId.HasValue)
                .Select(i => i.ItemTypeId!.Value).Distinct().ToList();
            var itemTypeMap = chosenItemTypeIds.Count == 0
                ? new Dictionary<int, ItemType>()
                : await _context.ItemTypes.Where(it => chosenItemTypeIds.Contains(it.Id))
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

        /// <summary>Stock OUT for every line bound to a tracked item type — the
        /// goods returned to the supplier reduce on-hand. No-op when tracking is
        /// off (RecordMovementAsync gates) or the line has no item type.</summary>
        private async Task RecordStockOutAsync(Models.PurchaseDebitNote note, List<Models.PurchaseDebitNoteItem> items, string supplierName)
        {
            var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(
                note.CompanyId, items.Where(i => i.ItemTypeId.HasValue).Select(i => i.ItemTypeId!.Value));
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
                    notes: $"Debit Note #{note.DebitNoteNumber} — return to {supplierName}",
                    divisionId: note.DivisionId);
            }
        }

        /// <summary>Reconcile posted stock to the new line set by the per-ItemType
        /// DELTA (desired OUT − posted net OUT). Emits an OUT for a positive delta,
        /// a compensating IN for a negative one, nothing when they match. Reads the
        /// posted net from the ledger (never synthesizing from current lines) so a
        /// classify-after-create line isn't over/under-reversed.</summary>
        private async Task ReconcileStockToLinesAsync(Models.PurchaseDebitNote note, List<Models.PurchaseDebitNoteItem> newItems)
        {
            var trackedNew = await _stock.GetStockTrackedItemTypeIdsAsync(
                note.CompanyId, newItems.Where(n => n.ItemTypeId.HasValue).Select(n => n.ItemTypeId!.Value));
            var desired = new Dictionary<int, decimal>();
            foreach (var ni in newItems)
            {
                if (!ni.ItemTypeId.HasValue || ni.Quantity <= 0) continue;
                if (!trackedNew.Contains(ni.ItemTypeId.Value)) continue;
                desired.TryGetValue(ni.ItemTypeId.Value, out var cur);
                desired[ni.ItemTypeId.Value] = cur + ni.Quantity;
            }

            // Currently posted net OUT per ItemType (Out − In), read from the ledger.
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
                    notes: $"Debit Note #{note.DebitNoteNumber} (edit — stock {(delta > 0m ? "decreased" : "restored")} by {Math.Abs(delta):0.####})",
                    divisionId: note.DivisionId);
            }
        }

        /// <summary>Reverse the note's actual posted stock: read its net OUT
        /// (Out − In) from the ledger and emit a compensating IN for each item
        /// with a positive net. Append-only — never deletes movement rows.</summary>
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
                    notes: notes,
                    divisionId: note.DivisionId);
            }
        }

        /// <summary>Subset of <paramref name="candidates"/> that are ACTIVE accounts
        /// of the company's CoA — a foreign/inactive id is coerced to null so the
        /// engine derives the account.</summary>
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
