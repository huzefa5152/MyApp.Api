using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
namespace MyApp.Api.Helpers;

public static class InventoryCostBasis
{
    public record Row(int ItemTypeId, decimal Quantity, decimal Value, DateTime Date);
    public static async Task<List<Row>> LoadAsync(AppDbContext db, int companyId, List<int>? ids = null)
    {
        var purchases = db.PurchaseItems.AsNoTracking().Where(p => p.PurchaseBill.CompanyId == companyId && p.ItemTypeId.HasValue && p.Quantity > 0);
        if (ids != null) purchases = purchases.Where(p => ids.Contains(p.ItemTypeId!.Value));
        var rows = await purchases.Select(p => new Row(p.ItemTypeId!.Value, p.Quantity, p.LineTotal, p.PurchaseBill.Date)).ToListAsync();
        var entries = db.StockEntries.AsNoTracking().Where(e => e.CompanyId == companyId && !e.IsCancelled && e.QuantityDelta > 0);
        if (ids != null) entries = entries.Where(e => ids.Contains(e.ItemTypeId));
        rows.AddRange(await entries.Select(e => new Row(e.ItemTypeId, e.QuantityDelta, e.QuantityDelta * e.UnitCost, e.Date)).ToListAsync());
        return rows;
    }
    public static decimal Average(IEnumerable<Row> rows) => rows.Sum(r => r.Quantity) > 0 ? rows.Sum(r => r.Value) / rows.Sum(r => r.Quantity) : 0;
}
