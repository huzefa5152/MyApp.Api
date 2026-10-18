using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations;

public class CommercialCostService(AppDbContext db, LocalPurchaseSyncService purchases)
{
    private async Task LockAsync(string kind, int id)
    {
        if (kind == "challan")
            await db.DeliveryChallans.FromSqlInterpolated($"SELECT * FROM DeliveryChallans WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}").AsNoTracking().Select(c => c.Id).ToListAsync();
        else
            await db.Invoices.FromSqlInterpolated($"SELECT * FROM Invoices WITH (UPDLOCK, HOLDLOCK) WHERE Id = {id}").AsNoTracking().Select(c => c.Id).ToListAsync();
        // Bill and challan views and the Purchase Bill form reach the same
        // source lines; lock them in the shared order.
        var deliveryIds = kind == "challan"
            ? await db.DeliveryItems.Where(i => i.DeliveryChallanId == id).Select(i => i.Id).ToListAsync()
            : await db.InvoiceItems.Where(i => i.InvoiceId == id && i.DeliveryItemId.HasValue).Select(i => i.DeliveryItemId!.Value).ToListAsync();
        var standaloneIds = kind == "bill"
            ? await db.InvoiceItems.Where(i => i.InvoiceId == id && !i.DeliveryItemId.HasValue).Select(i => i.Id).ToListAsync()
            : new List<int>();
        await LocalPurchaseAllocations.LockAsync(db, deliveryIds, standaloneIds);
    }

    public async Task<CommercialCostDto?> ReadAsync(string kind, int id)
    {
        CommercialCostDto? result;
        if (kind == "challan")
        {
            var c = await db.DeliveryChallans.AsNoTracking().Include(c => c.Items)
                .Include(c => c.Invoice).ThenInclude(i => i!.Items)
                .FirstOrDefaultAsync(c => c.Id == id && !c.IsDemo);
            if (c == null) return null;
            result = new() { Id = id, Number = c.ChallanNumber, CompanyId = c.CompanyId,
                Items = c.Items.OrderBy(i => i.Id).Select(i => new CommercialCostLineDto {
                    Id = i.Id, DeliveryItemId = i.Id, SourceChallanId = c.Id, Description = i.Description, Unit = i.Unit,
                    Quantity = i.Quantity, ActualUnitCost = i.ActualUnitCost, SupplierId = i.SupplierId,
                    SellingAmount = c.Invoice?.Items.Where(x => x.DeliveryItemId == i.Id).Sum(x => x.LineTotal) ?? 0
                }).ToList() };
        }
        else
        {
            var b = await db.Invoices.AsNoTracking().Include(b => b.Items).ThenInclude(i => i.DeliveryItem)
                .FirstOrDefaultAsync(b => b.Id == id && !b.IsDemo && b.NoteKind == 0);
            if (b == null) return null;
            result = new() { Id = id, Number = b.InvoiceNumber, CompanyId = b.CompanyId,
                Items = b.Items.OrderBy(i => i.Id).Select(i => new CommercialCostLineDto {
                    Id = i.Id, DeliveryItemId = i.DeliveryItemId, SourceChallanId = i.DeliveryItem?.DeliveryChallanId, Description = i.Description, Unit = i.UOM,
                    Quantity = i.Quantity, SellingAmount = i.LineTotal,
                    ActualUnitCost = i.DeliveryItemId.HasValue ? i.DeliveryItem?.ActualUnitCost : i.ActualUnitCost,
                    SupplierId = i.DeliveryItemId.HasValue ? i.DeliveryItem?.SupplierId : i.SupplierId
                }).ToList() };
        }
        var deliveryIds = result.Items.Where(i => i.DeliveryItemId.HasValue).Select(i => i.DeliveryItemId!.Value).ToList();
        var sourceDeliveries = await db.DeliveryItems.AsNoTracking().Where(i => deliveryIds.Contains(i.Id) && i.DeliveryChallan.CompanyId == result.CompanyId)
            .Select(i => new { i.Id, i.DeliveryChallan.ChallanNumber }).ToDictionaryAsync(i => i.Id);
        if (sourceDeliveries.Count != deliveryIds.Distinct().Count())
            throw new CommercialCostValidationException("A source delivery does not belong to this company.");
        foreach (var line in result.Items.Where(i => i.DeliveryItemId.HasValue))
            line.SourceChallanNumber = sourceDeliveries[line.DeliveryItemId!.Value].ChallanNumber;
        var invoiceIds = kind == "bill" ? result.Items.Select(i => i.Id).ToList() : new List<int>();
        var openAuto = LocalPurchaseSyncService.OpenAuto(db).Select(p => p.Id);
        var recorded = await db.PurchaseItems.AsNoTracking().Where(p => p.PurchaseBill.CompanyId == result.CompanyId &&
            ((p.LocalDeliveryItemId.HasValue && deliveryIds.Contains(p.LocalDeliveryItemId.Value)) ||
             (p.LocalInvoiceItemId.HasValue && invoiceIds.Contains(p.LocalInvoiceItemId.Value))))
            .GroupBy(p => new { p.LocalDeliveryItemId, p.LocalInvoiceItemId })
            .Select(g => new { g.Key.LocalDeliveryItemId, g.Key.LocalInvoiceItemId, Quantity = g.Sum(p => p.Quantity), Amount = g.Sum(p => p.LineTotal),
                Locked = g.Where(p => !openAuto.Contains(p.PurchaseBillId)).Sum(p => p.Quantity) }).ToListAsync();
        // Legacy = a challan bill from before line links existed. A bill that
        // links any line is allocation-tracked and never implies the others.
        var legacyChallans = await db.PurchaseBills.AsNoTracking().Where(p => p.CompanyId == result.CompanyId && p.SourceDeliveryChallanId.HasValue
                && !p.Items.Any(i => i.LocalDeliveryItemId.HasValue))
            .Select(p => p.SourceDeliveryChallanId!.Value).ToListAsync();
        var legacyItems = await db.DeliveryItems.AsNoTracking().Where(i => deliveryIds.Contains(i.Id) && legacyChallans.Contains(i.DeliveryChallanId))
            .Select(i => i.Id).ToListAsync();
        foreach (var i in result.Items)
        {
            var purchases = recorded.Where(p => i.DeliveryItemId.HasValue
                    ? p.LocalDeliveryItemId == i.DeliveryItemId
                    : p.LocalInvoiceItemId == i.Id).ToList();
            i.PurchasedQuantity = purchases.Sum(p => p.Quantity);
            i.PurchasedAmount = purchases.Sum(p => p.Amount);
            i.LockedQuantity = purchases.Sum(p => p.Locked);
            if (i.DeliveryItemId.HasValue && legacyItems.Contains(i.DeliveryItemId.Value) && i.PurchasedQuantity == 0)
                i.PurchasedQuantity = i.LockedQuantity = i.Quantity;
            i.PurchaseRecorded = i.RemainingQuantity <= 0;
        }
        result.Version = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(result.Items))));
        return result;
    }

    public async Task<CommercialCostDto> SaveAsync(string kind, int id, SaveCommercialCostsDto request, int actorId)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        await LockAsync(kind, id);
        var before = await ReadAsync(kind, id) ?? throw new KeyNotFoundException();
        if (request.Version != before.Version || request.Items.Count != before.Items.Count ||
            request.Items.Select(i => i.Id).Distinct().Count() != before.Items.Count ||
            request.Items.Any(i => !before.Items.Any(b => b.Id == i.Id)))
            throw new CommercialCostValidationException("The document changed. Reload costs before saving.");
        await ValidateAsync(before.CompanyId, request.Items);
        foreach (var i in request.Items)
        {
            var source = before.Items.Single(x => x.Id == i.Id);
            if (source.DeliveryItemId.HasValue)
            {
                var line = await db.DeliveryItems.SingleAsync(x => x.Id == source.DeliveryItemId);
                line.ActualUnitCost = i.ActualUnitCost; line.SupplierId = i.SupplierId;
            }
            else
            {
                var line = await db.InvoiceItems.SingleAsync(x => x.Id == i.Id && x.InvoiceId == id);
                line.ActualUnitCost = i.ActualUnitCost; line.SupplierId = i.SupplierId;
            }
        }
        db.Set<PrivateCostChange>().Add(new() { CompanyId = before.CompanyId, ActorId = actorId,
            Target = kind, TargetId = id, BeforeJson = JsonSerializer.Serialize(before.Items),
            AfterJson = JsonSerializer.Serialize(request.Items) });
        await db.SaveChangesAsync();
        if (kind == "challan") await purchases.SyncChallanAsync(id);
        else await purchases.SyncInvoiceSourcesAsync(id);
        await tx.CommitAsync();
        return (await ReadAsync(kind, id))!;
    }

    public async Task ValidateAsync(int companyId, IEnumerable<ChallanPrivateCostLineDto> items)
    {
        var lines = items.ToList();
        if (lines.Any(i => i.ActualUnitCost < 0)) throw new CommercialCostValidationException("Actual cost cannot be negative.");
        var ids = lines.Where(i => i.SupplierId.HasValue).Select(i => i.SupplierId!.Value).Distinct().ToList();
        if (await db.Suppliers.CountAsync(s => s.CompanyId == companyId && ids.Contains(s.Id)) != ids.Count)
            throw new CommercialCostValidationException("A supplier does not belong to this company.");
    }
}
