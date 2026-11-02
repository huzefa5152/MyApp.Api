using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;
namespace MyApp.Api.Services.Implementations;

public class StockEntryService(AppDbContext db, IStockService stock, IPostingService posting, IGeneralLedgerService ledger)
{
    public async Task<StockEntry> CreateAsync(CreateStockEntryDto dto)
    {
        if (dto.RequestId == Guid.Empty || dto.Kind is not ("Opening" or "Adjustment") || dto.Date == default || dto.Date.Date > PakistanClock.Today ||
            string.IsNullOrWhiteSpace(dto.Reason) || dto.Reason.Length > 500 || dto.QuantityDelta == 0 || decimal.Round(dto.QuantityDelta, 4) != dto.QuantityDelta ||
            Math.Abs(dto.QuantityDelta) > 1000000000m || dto.UnitCost > 1000000000m || dto.UnitCost < 0 || decimal.Round(dto.UnitCost, 4) != dto.UnitCost || dto.Kind == "Opening" && dto.QuantityDelta < 0)
            throw new InvalidOperationException("Enter a valid date, quantity, cost and reason.");
        await using var tx = await db.Database.BeginTransactionAsync();
        var company = await db.Companies.FromSqlInterpolated($"SELECT * FROM Companies WITH (UPDLOCK, HOLDLOCK) WHERE Id = {dto.CompanyId}").SingleAsync();
        if (!company.InventoryTrackingEnabled) throw new InvalidOperationException("Enable inventory tracking before recording stock entries.");
        var previous = await db.StockEntries.SingleOrDefaultAsync(e => e.CompanyId == dto.CompanyId && e.RequestId == dto.RequestId);
        if (previous != null)
        {
            if (previous.ItemTypeId != dto.ItemTypeId || previous.Kind != dto.Kind || previous.Date != dto.Date.Date || previous.QuantityDelta != dto.QuantityDelta ||
                previous.Reason != dto.Reason.Trim() || dto.QuantityDelta > 0 && previous.UnitCost != dto.UnitCost)
                throw new InvalidOperationException("This request already belongs to a different stock entry. Reopen the form.");
            await tx.CommitAsync();
            return previous;
        }
        var item = await db.ItemTypes.SingleOrDefaultAsync(i => i.Id == dto.ItemTypeId && i.CompanyId == dto.CompanyId && !i.IsDeleted);
        if (item == null || string.IsNullOrWhiteSpace(item.HSCode)) throw new InvalidOperationException("Choose a classified item from this company.");
        var unit = await db.Units.FirstOrDefaultAsync(u => u.CompanyId == dto.CompanyId && u.Name == item.UOM);
        if (unit?.AllowsDecimalQuantity == false && decimal.Truncate(dto.QuantityDelta) != dto.QuantityDelta)
            throw new InvalidOperationException("This unit requires a whole-number quantity.");
        if (dto.Kind == "Opening" && (await db.OpeningStockBalances.AnyAsync(e => e.CompanyId == dto.CompanyId && e.ItemTypeId == dto.ItemTypeId) ||
            await db.StockEntries.AnyAsync(e => e.CompanyId == dto.CompanyId && e.ItemTypeId == dto.ItemTypeId && e.Kind == "Opening" && !e.IsCancelled)))
            throw new InvalidOperationException("Opening stock is already recorded for this item. Use a stock adjustment instead.");
        await ledger.AssertPeriodOpenAsync(dto.CompanyId, dto.Date);
        var onHand = await stock.GetOnHandAsync(dto.CompanyId, item.Id);
        if (dto.QuantityDelta < 0 && onHand + dto.QuantityDelta < 0) throw new InvalidOperationException("This adjustment would make current stock negative.");
        var cost = dto.UnitCost;
        if (dto.QuantityDelta < 0)
        {
            var basis = await InventoryCostBasis.LoadAsync(db, dto.CompanyId, new() { item.Id });
            cost = decimal.Round(InventoryCostBasis.Average(basis.Where(r => r.Date <= dto.Date.Date)), 4);
        }
        if (cost <= 0 || Math.Abs(dto.QuantityDelta) * cost > 999999999999999m) throw new InvalidOperationException("Enter a positive unit cost; reductions need an existing cost basis.");
        var entry = new StockEntry { CompanyId = dto.CompanyId, ItemTypeId = item.Id, RequestId = dto.RequestId,
            Kind = dto.Kind, Date = dto.Date.Date, QuantityDelta = dto.QuantityDelta, UnitCost = cost, Reason = dto.Reason.Trim() };
        db.StockEntries.Add(entry);
        await db.SaveChangesAsync();
        await stock.RecordMovementAsync(entry.CompanyId, entry.ItemTypeId,
            entry.QuantityDelta > 0 ? StockMovementDirection.In : StockMovementDirection.Out, Math.Abs(entry.QuantityDelta),
            StockMovementSourceType.StockEntry, entry.Id, entry.Date, entry.Reason);
        await posting.PostStockEntryAsync(entry);
        await tx.CommitAsync();
        return entry;
    }

    public async Task CancelAsync(int companyId, int id)
    {
        await using var tx = await db.Database.BeginTransactionAsync();
        await db.Companies.FromSqlInterpolated($"SELECT * FROM Companies WITH (UPDLOCK, HOLDLOCK) WHERE Id = {companyId}").SingleAsync();
        var entry = await db.StockEntries.SingleAsync(e => e.Id == id && e.CompanyId == companyId);
        if (entry.IsCancelled) { await tx.CommitAsync(); return; }
        if (!await stock.IsTrackingEnabledAsync(companyId)) throw new InvalidOperationException("Enable inventory tracking before reversing an entry.");
        await ledger.AssertPeriodOpenAsync(companyId, entry.Date);
        var onHand = await stock.GetOnHandAsync(companyId, entry.ItemTypeId);
        if (entry.QuantityDelta > 0 && onHand - entry.QuantityDelta < 0)
            throw new InvalidOperationException("This stock has been used. Record a reviewed adjustment instead.");
        entry.IsCancelled = true;
        await db.SaveChangesAsync();
        await stock.RecordMovementAsync(companyId, entry.ItemTypeId,
            entry.QuantityDelta > 0 ? StockMovementDirection.Out : StockMovementDirection.In, Math.Abs(entry.QuantityDelta),
            StockMovementSourceType.StockEntry, entry.Id, entry.Date, $"Cancelled stock entry #{entry.Id}");
        await posting.PostStockEntryAsync(entry);
        await tx.CommitAsync();
    }
}
