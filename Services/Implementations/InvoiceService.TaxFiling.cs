using System.Data;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Services.Implementations;

public partial class InvoiceService
{
    private async Task<List<TaxFilingRowDto>> BuildNoteFilingRowsAsync(Invoice original,
        List<InvoiceItem> noteItems, List<int> sources, bool partial)
    {
        var plan = TaxFilingProjection.Plan(original)!;
        if (!partial) return plan.Rows;
        if (sources.Distinct().Count() != sources.Count)
            throw new InvalidOperationException("A source line may only appear once on the return note.");
        var units = await _context.Units.AsNoTracking().Where(u => u.CompanyId == original.CompanyId).ToListAsync();
        var result = new List<TaxFilingRowDto>();
        foreach (var row in plan.Rows) {
            var selected = row.SourceLineIds.Where(sources.Contains).ToList();
            if (selected.Count == 0) continue;
            var value = selected.Sum(id => noteItems[sources.IndexOf(id)].LineTotal);
            if (value > row.ValueExclTax)
                throw new InvalidOperationException("The refund exceeds this filed row's amount. Review the return against the filed invoice.");
            var qty = Math.Round(row.Quantity * value / row.ValueExclTax, 4, MidpointRounding.AwayFromZero);
            var allowsFraction = units.Any(u => string.Equals(u.Name, row.UOM, StringComparison.OrdinalIgnoreCase) && u.AllowsDecimalQuantity);
            if (qty <= 0 || (!allowsFraction && qty != decimal.Truncate(qty))
                || Math.Round(qty * row.ValueExclTax / row.Quantity, 2, MidpointRounding.AwayFromZero) != value)
                throw new InvalidOperationException("This partial refund cannot be represented at the filed row's rate and unit. Select a return amount that matches a valid filing quantity, or reverse the whole invoice.");
            result.Add(new TaxFilingRowDto {
                SourceLineIds = selected, ItemTypeId = row.ItemTypeId, Description = row.Description,
                HSCode = row.HSCode, UOM = row.UOM, FbrUOMId = row.FbrUOMId, SaleType = row.SaleType,
                RateId = row.RateId, SroScheduleNo = row.SroScheduleNo, SroItemSerialNo = row.SroItemSerialNo,
                RetailPrice = (row.RetailPrice ?? 0) * value / row.ValueExclTax,
                Quantity = qty, ValueExclTax = value
            });
        }
        var taxBase = result.Sum(r => string.Equals(r.SaleType, "3rd Schedule Goods", StringComparison.OrdinalIgnoreCase)
            ? r.RetailPrice ?? 0m : r.ValueExclTax);
        if (Math.Round(taxBase * original.GSTRate / 100m, 2) != Math.Round(noteItems.Sum(i => i.LineTotal) * original.GSTRate / 100m, 2))
            throw new InvalidOperationException("The partial return has a different retail tax base. Reverse the whole invoice to preserve the tax that was filed.");
        return result;
    }

    private TaxFilingEditorDto FilingEditor(Invoice bill) => new() {
        Bill = ToDto(bill), Version = TaxFilingProjection.EditVersion(bill),
        HasSavedRows = bill.TaxFilingRowsJson != null,
        RequiresReview = TaxFilingProjection.NeedsReReview(bill),
        Rows = TaxFilingProjection.Plan(bill)?.Rows ?? TaxFilingProjection.InitialRows(bill),
        InitialRows = TaxFilingProjection.InitialRows(bill, commercial: true)
    };

    public async Task<TaxFilingEditorDto?> GetTaxFilingAsync(int id)
    {
        var bill = await _invoiceRepo.GetByIdAsync(id);
        return bill == null ? null : FilingEditor(bill);
    }

    private async Task<ItemType> ResolveNewFilingClassificationAsync(TaxFilingRowDto row, int companyId)
    {
        var code = row.HSCode?.Trim();
        if (string.IsNullOrWhiteSpace(code))
            throw new InvalidOperationException("Choose an FBR HS code for every filing row.");
        var existing = await _context.ItemTypes.AsNoTracking()
            .Where(i => i.CompanyId == companyId && !i.IsDeleted && !i.IsHsCodePartial && i.HSCode == code)
            .OrderBy(i => i.Id).FirstOrDefaultAsync();
        if (existing != null)
        {
            row.ItemTypeId = existing.Id;
            return existing;
        }
        else
        {
            if (string.IsNullOrWhiteSpace(row.Description) || row.Description.Trim().Length > 500)
                throw new InvalidOperationException("Enter an item name within 500 characters for the new HS classification.");
            var official = (await _filingFbr.GetHSCodesAsync(companyId, code))
                .FirstOrDefault(h => h.HS_CODE.Trim() == code);
            if (official == null)
                throw new InvalidOperationException("This HS code could not be verified with FBR. Search the FBR catalog and select a result, then retry.");
            var hints = await _taxEngine.GetHsCodeHintsAsync(companyId, code);
            var uom = hints.Uoms.FirstOrDefault(u => u.UOM_ID == row.FbrUOMId
                && string.Equals(u.Description, row.UOM, StringComparison.OrdinalIgnoreCase));
            if (uom == null)
                throw new InvalidOperationException("Select a valid FBR unit for the new HS classification. Retry the lookup if no units are available.");
            var saleType = row.SelectedSaleType == null ? hints.DefaultSaleType : CanonicalFilingSaleType(row.SelectedSaleType);
            if (string.IsNullOrWhiteSpace(saleType))
                throw new InvalidOperationException("Choose a valid tax scenario on the bill before classifying a new HS code.");
            var created = await _itemTypes.CreateAsync(new ItemTypeDto {
                CompanyId = companyId, Name = row.Description.Trim(), HSCode = code,
                UOM = uom.Description, FbrUOMId = uom.UOM_ID, SaleType = saleType,
                FbrDescription = official.Description, IsFavorite = true
            }, companyId);
            row.ItemTypeId = created.Id;
            return new ItemType { Id = created.Id, CompanyId = companyId,
                Name = created.Name, HSCode = created.HSCode, UOM = created.UOM,
                FbrUOMId = created.FbrUOMId, SaleType = created.SaleType };
        }
    }

    private static string CanonicalFilingSaleType(string saleType) => TaxScenarios.All
        .Select(s => s.SaleType).FirstOrDefault(s => string.Equals(s, saleType.Trim(), StringComparison.OrdinalIgnoreCase))
        ?? throw new InvalidOperationException("Choose a valid FBR sale type for this filing row.");

    public async Task<TaxFilingEditorDto?> SaveTaxFilingAsync(int id, SaveTaxFilingDto dto, int actorId, string actorName, bool allowNumericalChanges)
    {
        // Lock the header before reading lines; bill edits/submission update the same header.
        await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        _context.ChangeTracker.Clear();
        var bill = await _context.Invoices.FromSqlInterpolated($"SELECT * FROM Invoices WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}")
            .Include(i => i.Company).Include(i => i.Client)
            .Include(i => i.Items).ThenInclude(i => i.Adjustment)
            .Include(i => i.Items).ThenInclude(i => i.ItemType)
            .Include(i => i.DeliveryChallans).AsSplitQuery().FirstOrDefaultAsync();
        if (bill == null) return null;
        if (!IsInvoiceEditable(bill) || bill.NoteKind != 0)
            throw new InvalidOperationException("Tax filing rows cannot be changed on a cancelled invoice, note or after submission has started.");
        if (dto.Version != TaxFilingProjection.EditVersion(bill))
            throw new InvalidOperationException("The bill or filing rows changed while you were editing. Reload and review the latest values.");
        TaxFilingProjection.ValidateCoverage(bill, dto.Rows);
        if (!allowNumericalChanges) {
            var baseline = TaxFilingProjection.Plan(bill)?.Rows ?? TaxFilingProjection.InitialRows(bill);
            var references = new List<TaxFilingRowDto>();
            foreach (var group in baseline) {
                var source = bill.Items.Where(i => group.SourceLineIds.Contains(i.Id)).Select(TaxFilingProjection.LegacyLine).ToList();
                if (group.Quantity == source.Sum(i => i.Quantity) && group.ValueExclTax == source.Sum(i => i.LineTotal))
                    references.AddRange(source.Select(i => new TaxFilingRowDto { SourceLineIds = new() { i.Id },
                        Quantity = i.Quantity, ValueExclTax = i.LineTotal, UOM = group.UOM }));
                else references.Add(group);
            }
            foreach (var row in dto.Rows) {
                var matched = references.Where(b => b.SourceLineIds.All(row.SourceLineIds.Contains)).ToList();
                if (!matched.SelectMany(b => b.SourceLineIds).Order().SequenceEqual(row.SourceLineIds.Order())
                    || row.Quantity != matched.Sum(b => b.Quantity) || row.ValueExclTax != matched.Sum(b => b.ValueExclTax)
                    || matched.Select(b => b.UOM.Trim().ToUpperInvariant()).Distinct().Count() > 1)
                    throw new InvalidOperationException("Your permission allows HS classification only. Changing quantities, amounts, splitting adjusted allocations or combining different units requires consultant quantity permission.");
            }
        }
        var ids = dto.Rows.Select(r => r.ItemTypeId).Where(i => i != null).Select(i => i!.Value).Distinct().ToList();
        var types = await _context.ItemTypes.AsNoTracking().Where(i => ids.Contains(i.Id)
            && i.CompanyId == bill.CompanyId && !i.IsDeleted).ToDictionaryAsync(i => i.Id);
        var units = await _context.Units.AsNoTracking().Where(u => u.CompanyId == bill.CompanyId)
            .ToListAsync();
        foreach (var row in dto.Rows) {
            if (row.ItemTypeId == null)
            {
                var resolved = await ResolveNewFilingClassificationAsync(row, bill.CompanyId);
                types[resolved.Id] = resolved;
            }
            if (row.ItemTypeId == null || !types.TryGetValue(row.ItemTypeId.Value, out var type))
                throw new InvalidOperationException("Choose a classification from this company's item catalog for every filing row.");
            if (string.IsNullOrWhiteSpace(type.HSCode) || type.IsHsCodePartial)
                throw new InvalidOperationException("Every filing row needs a complete HS code and sale type. Complete the selected catalog classification first.");
            var previous = TaxFilingProjection.Plan(bill)?.Rows.FirstOrDefault(r => r.ItemTypeId == type.Id && r.HSCode == type.HSCode
                && r.SourceLineIds.Order().SequenceEqual(row.SourceLineIds.Order()));
            row.HSCode = type.HSCode; row.SaleType = previous?.SaleType ?? type.SaleType;
            row.UOM = previous?.UOM ?? type.UOM ?? ""; row.FbrUOMId = previous?.FbrUOMId ?? type.FbrUOMId;
            if (row.SelectedFbrUOMId.HasValue && row.SelectedFbrUOMId != row.FbrUOMId)
            {
                var hints = await _taxEngine.GetHsCodeHintsAsync(bill.CompanyId, type.HSCode);
                var selectedUnit = hints.Uoms.FirstOrDefault(u => u.UOM_ID == row.SelectedFbrUOMId);
                if (selectedUnit == null)
                    throw new InvalidOperationException("Choose one of FBR's valid units for this HS code.");
                row.UOM = selectedUnit.Description; row.FbrUOMId = selectedUnit.UOM_ID;
            }
            if (row.SelectedSaleType != null) row.SaleType = CanonicalFilingSaleType(row.SelectedSaleType);
            if (string.IsNullOrWhiteSpace(row.SaleType))
                throw new InvalidOperationException("Choose a sale type for every filing row.");
            row.SelectedFbrUOMId = null; row.SelectedSaleType = null;
            row.Description = string.IsNullOrWhiteSpace(row.Description) ? type.Name : row.Description.Trim();
            if (row.Description.Length > 500 || string.IsNullOrWhiteSpace(row.UOM))
                throw new InvalidOperationException("Choose a classification with a unit and keep the description within 500 characters.");
            var unit = units.FirstOrDefault(u => string.Equals(u.Name, row.UOM, StringComparison.OrdinalIgnoreCase));
            if (row.Quantity != decimal.Truncate(row.Quantity) && unit?.AllowsDecimalQuantity != true)
                throw new InvalidOperationException("This filing unit requires a whole quantity. Enter the actual filing quantity for the combined row.");
            var sources = bill.Items.Where(i => row.SourceLineIds.Contains(i.Id)).ToList();
            row.RateId = sources[0].RateId;
            row.SroScheduleNo = sources[0].SroScheduleNo;
            row.SroItemSerialNo = sources[0].SroItemSerialNo;
            row.RetailPrice = sources.Sum(i => i.FixedNotifiedValueOrRetailPrice ?? 0m);
            if (row.SaleType.Contains("3rd", StringComparison.OrdinalIgnoreCase) && row.RetailPrice <= 0)
                throw new InvalidOperationException("Third-schedule goods need the original retail tax base. Keep this row separate and complete the bill's retail details first.");
        }
        var taxBase = dto.Rows.Sum(r => r.SaleType!.Contains("3rd", StringComparison.OrdinalIgnoreCase)
            ? r.RetailPrice ?? 0m : r.ValueExclTax);
        if (Math.Round(taxBase * bill.GSTRate / 100m, 2, MidpointRounding.AwayFromZero) != bill.GSTAmount)
            throw new InvalidOperationException("The selected classifications change the bill's sales tax. Keep incompatible tax treatments separate and reconcile the tax before saving.");
        var before = bill.TaxFilingRowsJson;
        bill.TaxFilingRowsJson = JsonSerializer.Serialize(new TaxFilingPlan {
            SourceVersion = TaxFilingProjection.SourceVersion(bill), Rows = dto.Rows,
            SavedAt = DateTime.UtcNow, SavedBy = actorId
        });
        bill.FbrReviewRequiredAt = null; bill.FbrReviewedAt = DateTime.UtcNow;
        bill.FbrStatus = null; bill.FbrErrorMessage = null;
        await _context.SaveChangesAsync();
        await transaction.CommitAsync();
        await transaction.DisposeAsync();
        // Filing rows change no commercial line, stock movement or GL entry.
        try {
            await _auditLog.LogAsync(new AuditLog {
                CompanyId = bill.CompanyId, UserName = actorName,
                ExceptionType = "TAX_FILING_ROWS_SAVED", Level = "Information",
                Message = $"Bill #{bill.InvoiceNumber}: {dto.Rows.Count} tax filing rows reviewed.",
                RequestBody = JsonSerializer.Serialize(new { Before = before, After = bill.TaxFilingRowsJson }),
                Timestamp = DateTime.UtcNow, OccurrenceCount = 1
            });
        } catch (Exception ex) { _logger.LogWarning(ex, "Tax filing audit could not be recorded for invoice {InvoiceId}", id); }
        return FilingEditor(bill);
    }
}
