using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

public partial class SalesOrderService
{
    private static string OrderVersion(SalesOrder o) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new { o.Id, o.ClientId, OrderDate=o.OrderDate.ToString("yyyy-MM-ddTHH:mm:ss.fffffff"), RequiredDate=o.RequiredDate?.ToString("yyyy-MM-ddTHH:mm:ss.fffffff"), o.CustomerPoNumber,
            CustomerPoDate=o.CustomerPoDate?.ToString("yyyy-MM-ddTHH:mm:ss.fffffff"), o.Site, o.Notes, o.Status, o.ManuallyClosed, o.SalesQuoteId,
            Items = o.Items.OrderBy(i => i.Id).Select(i => new { i.Id, i.Description, Quantity=i.Quantity.ToString("G29",System.Globalization.CultureInfo.InvariantCulture), i.Unit, i.ItemTypeId, UnitPrice=i.UnitPrice?.ToString("G29",System.Globalization.CultureInfo.InvariantCulture) }) }))));

    private Task LockCompanyAsync(int companyId) => _context.Database.ExecuteSqlRawAsync(
        "DECLARE @lock int; EXEC @lock=sp_getapplock @Resource={0}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000; IF @lock<0 THROW 51000, 'Could not lock sales documents', 1;",
        $"invoice-alloc-{companyId}");

    public async Task<SalesOrderDto> CreateFromBillAsync(int billId)
    {
        _context.ChangeTracker.Clear();
        var companyId = await _context.Invoices.Where(i => i.Id == billId).Select(i => (int?)i.CompanyId).SingleOrDefaultAsync()
            ?? throw new InvalidOperationException("Bill not found.");
        await using var tx = await _context.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        await LockCompanyAsync(companyId);
        await _context.Database.SqlQuery<int>($"SELECT Id AS Value FROM Invoices WITH (UPDLOCK,HOLDLOCK) WHERE Id={billId}").ToListAsync();
        var bill = await _context.Invoices.Include(i => i.Items).Include(i => i.DeliveryChallans).ThenInclude(c => c.Items)
            .AsSplitQuery().SingleAsync(i => i.Id == billId);
        if (bill.IsCancelled || bill.IsDemo || bill.DocumentType != 4 || bill.OriginalInvoiceId != null || bill.SupplementsInvoiceId != null)
            throw new InvalidOperationException("Only an ordinary active bill can create a sales order.");
        if (bill.DeliveryChallans.Count == 0)
            throw new InvalidOperationException("Standalone bills cannot create a sales order. This bill needs delivery challans.");
        if (bill.DeliveryChallans.Any(c => c.SalesOrderId != null || c.Items.Any(i => i.SalesOrderItemId != null)))
            throw new InvalidOperationException("A challan on this bill already belongs to an order. Open its existing order instead.");
        if (bill.DeliveryChallans.Any(c => c.CompanyId != bill.CompanyId || c.ClientId != bill.ClientId || c.Status == "Cancelled" || c.IsDemo || c.Items.Count == 0))
            throw new InvalidOperationException("Every challan must be active and belong to this bill's company and customer.");
        var deliveries = bill.DeliveryChallans.OrderBy(c => c.Id).SelectMany(c => c.Items.OrderBy(i => i.Id)).ToList();
        if (deliveries.Any(d => d.Quantity <= 0 || string.IsNullOrWhiteSpace(d.Unit)))
            throw new InvalidOperationException("Correct the challan quantities and units before creating an order.");
        var billLines = bill.Items.Where(i => i.DeliveryItemId != null).ToDictionary(i => i.DeliveryItemId!.Value);
        if (deliveries.Any(d => !billLines.ContainsKey(d.Id)))
            throw new InvalidOperationException("The bill and its challan items do not match. Reconcile them before creating an order.");
        var order = await CreateAsync(bill.CompanyId, new SalesOrderDto
        {
            ClientId = bill.ClientId, OrderDate = bill.Date,
            CustomerPoNumber = bill.DeliveryChallans.Select(c => c.PoNumber).Distinct().Count() == 1 ? bill.DeliveryChallans.First().PoNumber : null,
            CustomerPoDate = bill.DeliveryChallans.Select(c => c.PoDate).Distinct().Count() == 1 ? bill.DeliveryChallans.First().PoDate : null,
            Notes = $"Recorded from existing bill #{bill.InvoiceNumber}. Existing deliveries and billing preserved.",
            Items = deliveries.Select(d => new SalesOrderItemDto { ItemTypeId = d.ItemTypeId, Description = d.Description,
                Quantity = d.Quantity, Unit = d.Unit, UnitPrice = billLines[d.Id].UnitPrice }).ToList()
        });
        var entity = (await _repository.GetByIdAsync(order.Id))!;
        var lines = entity.Items.OrderBy(i => i.Id).ToList();
        for (int n=0; n<deliveries.Count; n++) deliveries[n].SalesOrderItemId = lines[n].Id;
        foreach (var challan in bill.DeliveryChallans) challan.SalesOrderId = order.Id;
        await _context.SaveChangesAsync();
        await SalesDocumentRules.RefreshOrdersAsync(_context, companyId);
        await tx.CommitAsync();
        return (await GetByIdAsync(order.Id))!;
    }

    private async Task ApplyOrderChangesToDocumentsAsync(SalesOrder order, Dictionary<int, SalesOrderItemDto> before, SalesOrderDto request)
    {
        if (!request.ApplyRatesToBills && !request.ApplyDetailsToDeliveries) return;
        var changed = order.Items.Where(i => before.TryGetValue(i.Id, out var old) &&
            ((request.ApplyRatesToBills && i.UnitPrice != old.UnitPrice) ||
             (request.ApplyDetailsToDeliveries && (i.Description != old.Description || i.Unit != old.Unit || i.ItemTypeId != old.ItemTypeId))))
            .ToDictionary(i => i.Id);
        if (changed.Count == 0) return;
        var deliveries = await _context.DeliveryItems.Include(d => d.DeliveryChallan).ThenInclude(c => c.Invoice)
            .Where(d => d.SalesOrderItemId != null && changed.Keys.Contains(d.SalesOrderItemId.Value) && d.DeliveryChallan.Status != "Cancelled")
            .ToListAsync();
        if (deliveries.Any(d => d.DeliveryChallan.Invoice != null && !SalesDocumentRules.BillEditable(d.DeliveryChallan.Invoice)))
            throw new InvalidOperationException("An affected delivery is on a submitted, submitting, uncertain or cancelled bill. Its commercial details are locked. Change only future order terms, or correct the filed bill through its existing correction workflow.");
        if (request.ApplyRatesToBills && deliveries.Any(d => d.DeliveryChallan.InvoiceId != null && changed[d.SalesOrderItemId!.Value].UnitPrice == null))
            throw new InvalidOperationException("Enter a rate for billed items, or leave the rate change for future bills only.");
        foreach (var group in deliveries.Where(d => d.DeliveryChallan.InvoiceId != null).GroupBy(d => d.DeliveryChallan.InvoiceId!.Value))
        {
            var bill = await _context.Invoices.Include(i => i.Items).SingleAsync(i => i.Id == group.Key);
            var mapping = group.ToDictionary(d => d.Id, d => changed[d.SalesOrderItemId!.Value]);
            await _invoices.UpdateAsync(bill.Id, new UpdateInvoiceDto
            {
                GSTRate = bill.GSTRate, FurtherTaxRate = bill.FurtherTaxRate, WithholdingTaxRate = bill.WithholdingTaxRate,
                WithholdingTaxAmount = bill.WithholdingTaxAmount, FreightCharges = bill.FreightCharges,
                DocumentType = bill.DocumentType, PaymentTerms = bill.PaymentTerms, PaymentMode = bill.PaymentMode, Notes = bill.Notes,
                Items = bill.Items.Select(i => {
                    mapping.TryGetValue(i.DeliveryItemId ?? -1, out var ordered);
                    return new UpdateInvoiceItemDto { Id=i.Id,
                        Description=request.ApplyDetailsToDeliveries && ordered != null ? ordered.Description : i.Description,
                        Quantity=i.Quantity, UOM=request.ApplyDetailsToDeliveries && ordered != null ? ordered.Unit : i.UOM,
                        UnitPrice=request.ApplyRatesToBills && ordered?.UnitPrice != null ? ordered.UnitPrice.Value : i.UnitPrice,
                        ItemTypeId=request.ApplyDetailsToDeliveries && ordered != null ? ordered.ItemTypeId : i.ItemTypeId,
                        HSCode=i.HSCode, FbrUOMId=i.FbrUOMId, SaleType=i.SaleType,
                        RateId=i.RateId, FixedNotifiedValueOrRetailPrice=i.FixedNotifiedValueOrRetailPrice,
                        SroScheduleNo=i.SroScheduleNo, SroItemSerialNo=i.SroItemSerialNo };
                }).ToList()
            });
        }
        if (request.ApplyDetailsToDeliveries)
            foreach (var delivery in deliveries)
            {
                var item = changed[delivery.SalesOrderItemId!.Value];
                delivery.Description=item.Description; delivery.Unit=item.Unit; delivery.ItemTypeId=item.ItemTypeId;
            }
        await _context.SaveChangesAsync();
    }
}
