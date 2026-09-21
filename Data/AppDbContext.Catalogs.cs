using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

public partial class AppDbContext
{
    private readonly IHttpContextAccessor? _catalogHttp;
    private bool CatalogSystemContext => _catalogHttp?.HttpContext == null;
    private int? CatalogCompanyId => _catalogHttp?.HttpContext?.Items["currentCompanyId"] as int?;
    private int[] CatalogAllowedIds => _catalogHttp?.HttpContext?.Items["catalogAllowedIds"] as int[] ?? Array.Empty<int>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess) =>
        SaveChangesAsync(acceptAllChangesOnSuccess).GetAwaiter().GetResult();

    public override async Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        await ValidateCatalogWritesAsync(cancellationToken);
        return await base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private async Task ValidateCatalogWritesAsync(CancellationToken ct)
    {
        ChangeTracker.DetectChanges();
        var changed = ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified).ToList();
        foreach (var entry in changed.Where(e => e.Entity is ItemType or ItemDescription or Unit))
        {
            var owner = entry.Property("CompanyId");
            if (!CatalogSystemContext)
            {
                if (CatalogCompanyId is not int companyId)
                    throw new InvalidOperationException("Choose a company before changing its catalog.");
                if (entry.State == EntityState.Added && owner.CurrentValue == null) owner.CurrentValue = companyId;
                if (owner.CurrentValue is not int actual || actual != companyId
                    || entry.State == EntityState.Modified && !Equals(owner.OriginalValue, owner.CurrentValue))
                    throw new UnauthorizedAccessException("Catalog ownership cannot be changed.");
            }
        }

        // Navigation/query filters alone cannot reject a foreign id written
        // directly into a nullable FK. Validate every document/stock write too.
        var links = new List<(int ItemId, int CompanyId)>();
        foreach (var entry in changed)
        {
            int? itemId = entry.Entity switch {
                InvoiceItem x => x.ItemTypeId, DeliveryItem x => x.ItemTypeId,
                PurchaseItem x => x.ItemTypeId, GoodsReceiptItem x => x.ItemTypeId,
                SalesOrderItem x => x.ItemTypeId, SalesQuoteItem x => x.ItemTypeId,
                StockMovement x => x.ItemTypeId, OpeningStockBalance x => x.ItemTypeId,
                InvoiceItemAdjustment x => x.AdjustedItemTypeId, _ => null };
            if (itemId == null) continue;
            int companyId = entry.Entity switch {
                InvoiceItem x => x.Invoice?.CompanyId ?? await Invoices.Where(p=>p.Id==x.InvoiceId).Select(p=>p.CompanyId).SingleAsync(ct),
                DeliveryItem x => x.DeliveryChallan?.CompanyId ?? await DeliveryChallans.Where(p=>p.Id==x.DeliveryChallanId).Select(p=>p.CompanyId).SingleAsync(ct),
                PurchaseItem x => x.PurchaseBill?.CompanyId ?? await PurchaseBills.Where(p=>p.Id==x.PurchaseBillId).Select(p=>p.CompanyId).SingleAsync(ct),
                GoodsReceiptItem x => x.GoodsReceipt?.CompanyId ?? await GoodsReceipts.Where(p=>p.Id==x.GoodsReceiptId).Select(p=>p.CompanyId).SingleAsync(ct),
                SalesOrderItem x => x.SalesOrder?.CompanyId ?? await SalesOrders.Where(p=>p.Id==x.SalesOrderId).Select(p=>p.CompanyId).SingleAsync(ct),
                SalesQuoteItem x => x.SalesQuote?.CompanyId ?? await SalesQuotes.Where(p=>p.Id==x.SalesQuoteId).Select(p=>p.CompanyId).SingleAsync(ct),
                StockMovement x => x.CompanyId, OpeningStockBalance x => x.CompanyId,
                InvoiceItemAdjustment x => await InvoiceItems.Where(p=>p.Id==x.InvoiceItemId).Select(p=>p.Invoice.CompanyId).SingleAsync(ct),
                _ => throw new InvalidOperationException("Unknown catalog link.") };
            links.Add((itemId.Value, companyId));
        }
        if (links.Count == 0) return;
        var ids = links.Select(x=>x.ItemId).Distinct().ToList();
        var owners = await ItemTypes.IgnoreQueryFilters().Where(x=>ids.Contains(x.Id))
            .Select(x=>new {x.Id,x.CompanyId}).ToDictionaryAsync(x=>x.Id,x=>x.CompanyId,ct);
        if (links.Any(x=>!owners.TryGetValue(x.ItemId,out var owner) || owner != x.CompanyId))
            throw new InvalidOperationException("An item type does not belong to this document's company.");
    }
}
