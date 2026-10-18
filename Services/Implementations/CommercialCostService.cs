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

public class CommercialCostService(AppDbContext db, IPostingService posting)
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
        var recorded = await db.PurchaseItems.AsNoTracking().Where(p => p.PurchaseBill.CompanyId == result.CompanyId &&
            ((p.LocalDeliveryItemId.HasValue && deliveryIds.Contains(p.LocalDeliveryItemId.Value)) ||
             (p.LocalInvoiceItemId.HasValue && invoiceIds.Contains(p.LocalInvoiceItemId.Value))))
            .GroupBy(p => new { p.LocalDeliveryItemId, p.LocalInvoiceItemId })
            .Select(g => new { g.Key.LocalDeliveryItemId, g.Key.LocalInvoiceItemId, Quantity = g.Sum(p => p.Quantity), Amount = g.Sum(p => p.LineTotal) }).ToListAsync();
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
            if (i.DeliveryItemId.HasValue && legacyItems.Contains(i.DeliveryItemId.Value) && i.PurchasedQuantity == 0)
                i.PurchasedQuantity = i.Quantity;
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

    public async Task<List<int>> CreatePurchasesAsync(string kind, int id, CreateLocalPurchasesDto request)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);
        await LockAsync(kind, id);
        var source = await ReadAsync(kind, id) ?? throw new KeyNotFoundException();
        if (source.Version != request.Version || request.Date == default || request.ItemIds.Count == 0 ||
            request.ItemIds.Distinct().Count() != request.ItemIds.Count)
            throw new CommercialCostValidationException("Refresh the preview and select ready lines and a purchase date.");
        var items = source.Items.Where(i => request.ItemIds.Contains(i.Id)).ToList();
        if (items.Count != request.ItemIds.Count || items.Any(i => i.RemainingQuantity <= 0 || !i.SupplierId.HasValue || !i.ActualUnitCost.HasValue))
            throw new CommercialCostValidationException("Select unprocessed lines with a supplier, actual cost and positive quantity.");
        // Quantity to buy per line: the remaining quantity unless the review
        // asked for less. Never more than what is left.
        var quantities = request.Quantities ?? new();
        if (quantities.Keys.Any(k => !request.ItemIds.Contains(k)))
            throw new CommercialCostValidationException("Refresh the preview and select ready lines and a purchase date.");
        decimal Qty(CommercialCostLineDto i) => quantities.TryGetValue(i.Id, out var q) ? q : i.RemainingQuantity;
        if (items.Any(i => Qty(i) <= 0 || Qty(i) > i.RemainingQuantity))
            throw new CommercialCostValidationException("A purchase quantity must be more than zero and no more than the quantity still to purchase.");
        var cancelled = kind == "challan"
            ? await db.DeliveryChallans.AnyAsync(c => c.Id == id && c.Status == "Cancelled")
            : await db.Invoices.AnyAsync(b => b.Id == id && b.IsCancelled);
        if (cancelled) throw new CommercialCostValidationException("Cannot generate purchases from a cancelled document.");
        await ValidateAsync(source.CompanyId, items.Select(i => new ChallanPrivateCostLineDto { SupplierId = i.SupplierId, ActualUnitCost = i.ActualUnitCost }));
        var created = new List<int>();
        if (request.Suppliers.Any(s => s.GSTRate < 0 || s.GSTRate > 100 || Math.Round(s.GSTRate, 2) != s.GSTRate || s.SupplierBillNumber?.Length > 100) ||
            request.Suppliers.Select(s => (s.SupplierId, s.ChallanId)).Distinct().Count() != request.Suppliers.Count)
            throw new CommercialCostValidationException("Check supplier references and GST rates (0 to 100, up to two decimal places).");
        foreach (var group in items.GroupBy(i => new { i.SupplierId, ChallanId = i.SourceChallanId }))
        {
            var settings = request.Suppliers.SingleOrDefault(s => s.SupplierId == group.Key.SupplierId && s.ChallanId == group.Key.ChallanId);
            var bill = new PurchaseBill { CompanyId = source.CompanyId, SupplierId = group.Key.SupplierId!.Value,
                SourceInvoiceId = kind == "bill" && !group.Key.ChallanId.HasValue ? id : null,
                Source = "local-direct", PurchaseCategory = "LocalDirect", Date = request.Date.Date,
                PurchaseBillNumber = await CompanyDocumentNumbers.AllocateAsync(db, source.CompanyId, "purchase-bill"),
                ReconciliationStatus = "ManualOnly", Notes = $"Local purchase from {kind} #{source.Number}",
                SupplierBillNumber = settings?.SupplierBillNumber?.Trim(), GSTRate = settings?.GSTRate ?? 0,
                Items = group.Select(i => new PurchaseItem { Description = i.Description, Quantity = Qty(i),
                    UOM = i.Unit, UnitPrice = i.ActualUnitCost!.Value, LineTotal = Math.Round(Qty(i) * i.ActualUnitCost.Value, 2),
                    LocalDeliveryItemId = i.DeliveryItemId, LocalInvoiceItemId = i.DeliveryItemId.HasValue ? null : i.Id }).ToList() };
            bill.Subtotal = bill.Items.Sum(i => i.LineTotal);
            bill.GSTAmount = Math.Round(bill.Subtotal * bill.GSTRate / 100m, 2);
            bill.GrandTotal = bill.Subtotal + bill.GSTAmount;
            bill.AmountInWords = NumberToWordsConverter.Convert(bill.GrandTotal);
            db.PurchaseBills.Add(bill);
            await db.SaveChangesAsync();
            await posting.PostPurchaseBillAsync(bill);
            created.Add(bill.Id);
        }
        await tx.CommitAsync();
        return created;
    }
}
