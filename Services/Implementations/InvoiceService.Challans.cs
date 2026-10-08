using System.Data;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;

namespace MyApp.Api.Services.Implementations;

public partial class InvoiceService
{
    private object Scalars(object entity) => _context.Entry(entity).Properties
        .OrderBy(p => p.Metadata.Name).ToDictionary(p => p.Metadata.Name, p =>
            p.CurrentValue is DateTime dt ? (object)dt.ToString("yyyy-MM-ddTHH:mm:ss.fffffff", System.Globalization.CultureInfo.InvariantCulture)
            : p.CurrentValue is decimal number ? number.ToString("G29", System.Globalization.CultureInfo.InvariantCulture) : p.CurrentValue);

    private static string HashSnapshot(object value) => Convert.ToHexString(
        SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(value)));

    private string BillChallanVersion(Invoice invoice) => HashSnapshot(new
    {
        Header = Scalars(invoice),
        Items = invoice.Items.OrderBy(i => i.Id).Select(i => new
        {
            Line = Scalars(i), Overlay = i.Adjustment == null ? null : Scalars(i.Adjustment)
        }),
        Challans = invoice.DeliveryChallans.OrderBy(c => c.Id).Select(Scalars)
    });

    private string ChallanVersion(DeliveryChallan challan) => HashSnapshot(new
    {
        Header = Scalars(challan), Items = challan.Items.OrderBy(i => i.Id).Select(Scalars)
    });

    private static void AssertChallanEditAllowed(Invoice invoice)
    {
        if (!IsInvoiceEditable(invoice))
            throw new InvalidOperationException("Challans cannot be changed on a cancelled bill or after FBR submission has started. Refresh the bill to check its status.");
        if (invoice.IsDemo || invoice.DocumentType != 4 || invoice.OriginalInvoiceId.HasValue
            || invoice.SupplementsInvoiceId.HasValue)
            throw new InvalidOperationException("Challan selection can only be changed on an ordinary sale bill.");
    }

    public async Task<BillChallanOptionsDto?> GetBillChallanOptionsAsync(int id, string? search)
    {
        var invoice = await _invoiceRepo.GetByIdAsync(id);
        if (invoice == null) return null;
        AssertChallanEditAllowed(invoice);
        var linked = await _context.DeliveryChallans.Where(c => c.InvoiceId == id)
            .Include(c => c.SalesOrder).Include(c => c.Items).OrderBy(c => c.Id).ToListAsync();
        var query = _context.DeliveryChallans.Where(c => c.CompanyId == invoice.CompanyId
            && c.ClientId == invoice.ClientId && !c.IsDemo && c.InvoiceId == null
            && ChallanBillingRules.Statuses.Contains(c.Status));
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            query = query.Where(c => c.ChallanNumber.ToString().Contains(term) || c.PoNumber.Contains(term)
                || c.Items.Any(i => i.Description.Contains(term)));
        }
        var available = await query.Include(c => c.SalesOrder).Include(c => c.Items).OrderByDescending(c => c.DeliveryDate)
            .ThenByDescending(c => c.Id).Take(101).ToListAsync();
        BillChallanOptionDto Map(DeliveryChallan c) => new()
        {
            Id = c.Id, ChallanNumber = c.ChallanNumber, PoNumber = c.PoNumber,
            SalesOrderId = c.SalesOrderId, SalesOrderNumber = c.SalesOrder?.SalesOrderNumber,
            DeliveryDate = c.DeliveryDate, Version = ChallanVersion(c),
            Items = c.Items.OrderBy(i => i.Id).Select(i => new BillChallanItemDto
            { Id = i.Id, Description = i.Description, Quantity = i.Quantity, Unit = i.Unit }).ToList()
        };
        return new BillChallanOptionsDto
        {
            Bill = ToDto(invoice), Version = BillChallanVersion(invoice), Linked = linked.Select(Map).ToList(),
            Available = available.Take(100).Select(Map).ToList(), HasMore = available.Count > 100
        };
    }

    private void RecalculateBillTotals(Invoice invoice)
    {
        invoice.Subtotal = invoice.Items.Sum(i => i.LineTotal);
        invoice.GSTAmount = Math.Round(invoice.Subtotal * invoice.GSTRate / 100, 2);
        invoice.FurtherTaxAmount = FurtherTaxCalculator.Resolve(invoice.FurtherTaxRate, invoice.Subtotal);
        invoice.GrandTotal = FurtherTaxCalculator.GrandTotal(invoice.Subtotal, invoice.GSTAmount, invoice.FurtherTaxAmount);
        invoice.WithholdingTaxAmount = WithholdingTaxCalculator.Resolve(
            invoice.WithholdingTaxRate, invoice.GrandTotal, invoice.WithholdingTaxAmount);
        if (invoice.AmountPaid > CommercialTotalCalculator.Collectible(
            invoice.GrandTotal, invoice.WithholdingTaxAmount, invoice.FreightCharges))
            throw new InvalidOperationException("The commercial bill total cannot be less than receipts already allocated to this bill. Reallocate those receipts first.");
        invoice.AmountInWords = NumberToWordsConverter.Convert(invoice.GrandTotal);
    }

    private async Task LockBillForEditAsync(int id)
    {
        // Hold the row against the FBR submit claim until this transaction ends.
        await _context.Database.SqlQuery<int>($"SELECT [Id] AS [Value] FROM [Invoices] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {id}").ToListAsync();
    }

    private async Task AssertBillSnapshotCurrentAsync(Invoice invoice)
    {
        await AcquireInvoiceNumberLockAsync(invoice.CompanyId);
        await LockBillForEditAsync(invoice.Id);
        var fresh = await _context.Invoices.AsNoTracking().AsSplitQuery()
            .Include(i => i.Items).ThenInclude(i => i.Adjustment)
            .Include(i => i.DeliveryChallans).SingleAsync(i => i.Id == invoice.Id);
        if (!IsInvoiceEditable(fresh) || BillChallanVersion(fresh) != BillChallanVersion(invoice))
            throw new InvalidOperationException("This bill changed or FBR submission started. Refresh it before saving again.");
    }

    public Task<InvoiceDto?> UpdateBillChallansAsync(int id, UpdateBillChallansDto dto, string? actorUserName = null) =>
        UpdateBillChallansCoreAsync(id, dto, actorUserName, null);

    private async Task<InvoiceDto?> UpdateBillChallansCoreAsync(int id, UpdateBillChallansDto dto, string? actorUserName, string? removalAction)
    {
        if (dto.ChallanIds == null || dto.UnitPrices == null || dto.AddedChallanVersions == null
            || dto.ChallanIds.Count > 100 || dto.ChallanIds.Any(i => i <= 0)
            || dto.ChallanIds.Distinct().Count() != dto.ChallanIds.Count)
            throw new InvalidOperationException("Select each challan only once (up to 100 challans).");

        // The controller's access check may have tracked an earlier snapshot.
        _context.ChangeTracker.Clear();
        var companyId = await _context.Invoices.Where(i => i.Id == id).Select(i => (int?)i.CompanyId).SingleOrDefaultAsync();
        if (!companyId.HasValue) return null;
        await using var transaction = await _context.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        await AcquireInvoiceNumberLockAsync(companyId.Value);
        await LockBillForEditAsync(id);
        var invoice = await _invoiceRepo.GetByIdAsync(id);
        if (invoice == null) return null;
        AssertChallanEditAllowed(invoice);
        if (string.IsNullOrWhiteSpace(dto.Version) || dto.Version != BillChallanVersion(invoice))
            throw new InvalidOperationException("This bill changed while you were selecting challans. Reload it and review your selection again.");
        var company = await _context.Companies.SingleAsync(c => c.Id == invoice.CompanyId);
        if (company.GlLockDate.HasValue && invoice.Date.Date <= company.GlLockDate.Value.Date)
            throw new InvalidOperationException("This bill is in a locked accounting period. Reopen the period before changing challans.");
        if (await _context.Invoices.AnyAsync(i => i.OriginalInvoiceId == id && !i.IsCancelled))
            throw new InvalidOperationException("This bill has a live credit or debit note. Resolve the note before changing challans.");

        var originalOrderIds = invoice.DeliveryChallans.Select(c => c.SalesOrderId).Where(i => i != null).Distinct().ToList();
        var currentIds = invoice.DeliveryChallans.Select(c => c.Id).ToHashSet();
        var selectedIds = dto.ChallanIds.ToHashSet();
        var addedIds = selectedIds.Except(currentIds).ToList();
        var removedIds = currentIds.Except(selectedIds).ToList();
        var added = await _context.DeliveryChallans.Where(c => addedIds.Contains(c.Id))
            .Include(c => c.Items).ThenInclude(i => i.ItemType).OrderBy(c => c.Id).ToListAsync();
        if (added.Count != addedIds.Count || added.Any(c => c.CompanyId != invoice.CompanyId
            || c.ClientId != invoice.ClientId || c.IsDemo || !ChallanBillingRules.IsBillable(c.Status, c.InvoiceId)))
            throw new InvalidOperationException("A selected challan is unavailable, already billed, or belongs to a different company or customer. Refresh the selection.");
        if (added.Any(c => !dto.AddedChallanVersions.TryGetValue(c.Id, out var version) || version != ChallanVersion(c)))
            throw new InvalidOperationException("A selected challan changed. Reload it and review its items and rates again.");
        var newItems = added.SelectMany(c => c.Items).ToList();
        if (newItems.Any(i => i.ItemTypeId.HasValue && (i.ItemType == null || i.ItemType.CompanyId != invoice.CompanyId || i.ItemType.IsDeleted)))
            throw new InvalidOperationException("An added challan uses an unavailable item type. Correct the challan first.");
        await ValidateUpdateItemDecimalQuantitiesAsync(newItems.Select(i => new UpdateInvoiceItemDto
            { Id = i.Id, Quantity = i.Quantity, UOM = i.Unit }).ToList());
        if (added.Any(c => c.Items.Count == 0) || newItems.Any(i => i.Quantity <= 0 || string.IsNullOrWhiteSpace(i.Unit)))
            throw new InvalidOperationException("Each added challan needs items with positive quantities and a unit.");
        if (!dto.UnitPrices.Keys.ToHashSet().SetEquals(newItems.Select(i => i.Id))
            || dto.UnitPrices.Values.Any(p => p < 0 || p > 999999.999999999999m || Math.Round(p, 12) != p))
            throw new InvalidOperationException("Enter a valid non-negative unit rate for every item on the added challans.");
        var newDeliveryItemIds = newItems.Select(n => n.Id).ToList();
        if (await _context.InvoiceItems.AnyAsync(i => i.DeliveryItemId.HasValue
            && newDeliveryItemIds.Contains(i.DeliveryItemId.Value)))
            throw new InvalidOperationException("An item on a selected challan is already included in another bill.");

        var removedDeliveryIds = await _context.DeliveryItems.Where(i => removedIds.Contains(i.DeliveryChallanId))
            .Select(i => i.Id).ToListAsync();
        if (removalAction != null && await _context.PurchaseBills.AnyAsync(p => p.SourceDeliveryChallanId != null && removedIds.Contains(p.SourceDeliveryChallanId.Value)))
            throw new InvalidOperationException("This challan has linked purchase bills. Resolve those purchases before cancelling or deleting its delivery.");
        var removedLines = invoice.Items.Where(i => i.DeliveryItemId.HasValue
            && removedDeliveryIds.Contains(i.DeliveryItemId.Value)).ToList();
        if (invoice.Items.Count - removedLines.Count + newItems.Count == 0)
            throw new InvalidOperationException("A bill must keep at least one item. Replace its last challan, or void the bill instead.");
        if (addedIds.Count == 0 && removedIds.Count == 0)
            return ToDto(invoice);

        foreach (var line in removedLines)
        {
            if (line.Adjustment != null) _context.InvoiceItemAdjustments.Remove(line.Adjustment);
            invoice.Items.Remove(line);
            _context.InvoiceItems.Remove(line);
        }
        // Reuse the same release transition as a cancelled/reversed bill.
        var release = new Invoice { DeliveryChallans = invoice.DeliveryChallans.Where(c => removedIds.Contains(c.Id)).ToList() };
        ReleaseChallans(release);
        foreach (var challan in release.DeliveryChallans) invoice.DeliveryChallans.Remove(challan);
        foreach (var challan in release.DeliveryChallans)
        {
            if (removalAction == "cancel") challan.Status = "Cancelled";
            if (removalAction == "delete")
            {
                var latest = await _context.DeliveryChallans.Where(c => c.CompanyId == invoice.CompanyId).MaxAsync(c => c.ChallanNumber);
                if (challan.DuplicatedFromId == null && challan.ChallanNumber != latest)
                    throw new InvalidOperationException("Only the latest challan or a duplicate can be deleted. Cancel this challan instead.");
                _context.DeliveryChallans.Remove(challan);
            }
        }
        if (dto.AttachAddedChallansToOrder && added.Any(c => c.SalesOrderId == null))
        {
            var orderIds = originalOrderIds;
            if (orderIds.Count != 1)
                throw new InvalidOperationException("Choose the target sales order by attaching this challan on the order screen first, or leave the added challan independent.");
            var order = await _context.SalesOrders.Include(o => o.Items).SingleAsync(o => o.Id == orderIds[0] && o.CompanyId == invoice.CompanyId);
            if (order.Status == "Cancelled") throw new InvalidOperationException("A cancelled sales order cannot receive new challans.");
            foreach (var challan in added.Where(c => c.SalesOrderId == null))
            {
                if (!string.IsNullOrWhiteSpace(challan.PoNumber) && !string.IsNullOrWhiteSpace(order.CustomerPoNumber)
                    && !challan.PoNumber.Trim().Equals(order.CustomerPoNumber.Trim(), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("An added challan has a different customer PO. Keep it independent or correct its order linkage first.");
                foreach (var delivery in challan.Items)
                {
                    var matches = order.Items.Where(i => i.Description.Trim().Equals(delivery.Description.Trim(), StringComparison.OrdinalIgnoreCase)
                        && i.Unit.Equals(delivery.Unit, StringComparison.OrdinalIgnoreCase) && i.ItemTypeId == delivery.ItemTypeId).ToList();
                    if (matches.Count != 1)
                        throw new InvalidOperationException("An added challan needs one matching ordered line. Add or select its line on the sales order first, or leave this challan independent.");
                    delivery.SalesOrderItemId = matches[0].Id;
                }
                challan.SalesOrderId = order.Id;
            }
        }
        foreach (var challan in added)
        {
            challan.InvoiceId = id;
            challan.Status = "Invoiced";
            invoice.DeliveryChallans.Add(challan);
            foreach (var item in challan.Items)
            {
                var type = item.ItemType;
                invoice.Items.Add(new InvoiceItem
                {
                    DeliveryItemId = item.Id, Description = item.Description, Quantity = item.Quantity,
                    UOM = item.Unit, UnitPrice = dto.UnitPrices[item.Id],
                    LineTotal = Math.Round(item.Quantity * dto.UnitPrices[item.Id], 2, MidpointRounding.AwayFromZero),
                    ItemTypeId = item.ItemTypeId, ItemTypeName = type?.Name ?? "",
                    HSCode = type?.HSCode, FbrUOMId = type?.FbrUOMId,
                    SaleType = !string.IsNullOrWhiteSpace(type?.SaleType) ? type.SaleType
                        : (!string.IsNullOrWhiteSpace(company.FbrDefaultSaleType) ? company.FbrDefaultSaleType : "Goods at Standard Rate (default)")
                });
            }
        }
        invoice.FbrReviewRequiredAt = DateTime.UtcNow;
        RecalculateBillTotals(invoice);
        invoice.FbrStatus = null;
        invoice.FbrErrorMessage = null;
        await _context.SaveChangesAsync();
        await _stock.SyncInvoiceStockMovementsAsync(invoice);
        await _posting.PostInvoiceAsync(invoice);
        var warnings = await EnforceStockGuardAfterSyncAsync(invoice);
        await SalesDocumentRules.RefreshOrdersAsync(_context, invoice.CompanyId);
        var audit = new AuditLog
        {
            Timestamp = DateTime.UtcNow, Level = "Information", UserName = actorUserName,
            HttpMethod = "PUT", RequestPath = $"/api/invoices/{id}/challans", StatusCode = 200,
            ExceptionType = "BILL_CHALLANS_CHANGED", CompanyId = invoice.CompanyId,
            Message = $"Bill #{invoice.InvoiceNumber}: added challan ids [{string.Join(",", addedIds)}], removed [{string.Join(",", removedIds)}].",
            RequestBody = JsonSerializer.Serialize(new { dto.ChallanIds, dto.UnitPrices, removalAction, dto.AttachAddedChallansToOrder }), OccurrenceCount = 1
        };
        await transaction.CommitAsync();
        await transaction.DisposeAsync();
        await _auditLog.LogAsync(audit);
        var result = ToDto((await _invoiceRepo.GetByIdAsync(id))!);
        result.StockWarnings = warnings;
        return result;
    }
    public async Task AssertCommercialBillMutationAsync(int id)
    {
        var bill = await _invoiceRepo.GetByIdAsync(id) ?? throw new InvalidOperationException("Linked bill not found.");
        await AssertBillSnapshotCurrentAsync(bill);
        if (await _context.Invoices.AnyAsync(i => i.OriginalInvoiceId == id && !i.IsCancelled))
            throw new InvalidOperationException("Resolve the bill's active credit or debit note before changing its delivery.");
        var locked = await _context.Companies.Where(c => c.Id == bill.CompanyId).Select(c => c.GlLockDate).SingleAsync();
        if (locked.HasValue && bill.Date.Date <= locked.Value.Date)
            throw new InvalidOperationException("The linked bill is in a locked accounting period.");
    }

    public async Task ReconcileChallanBillAsync(int id)
    {
        var bill = await _invoiceRepo.GetByIdAsync(id) ?? throw new InvalidOperationException("Linked bill not found.");
        if (bill.Items.Count == 0)
            throw new InvalidOperationException("This would leave an empty bill. Replace its challan, or cancel the bill explicitly first.");
        RecalculateBillTotals(bill);
        bill.FbrReviewRequiredAt = DateTime.UtcNow;
        bill.FbrStatus = null; bill.FbrErrorMessage = null;
        await _context.SaveChangesAsync();
        await _stock.SyncInvoiceStockMovementsAsync(bill);
        await _posting.PostInvoiceAsync(bill);
        await EnforceStockGuardAfterSyncAsync(bill);
        await SalesDocumentRules.RefreshOrdersAsync(_context, bill.CompanyId);
    }

    public async Task RemoveBilledChallanAsync(int challanId, bool delete)
    {
        var billId = await _context.DeliveryChallans.Where(c => c.Id == challanId).Select(c => c.InvoiceId).SingleAsync();
        if (billId == null) throw new InvalidOperationException("The challan is no longer billed. Reload and try again.");
        var snapshot = await GetBillChallanOptionsAsync(billId.Value, null) ?? throw new InvalidOperationException("Bill not found.");
        await UpdateBillChallansCoreAsync(billId.Value, new UpdateBillChallansDto
        {
            Version = snapshot.Version, ChallanIds = snapshot.Linked.Where(c => c.Id != challanId).Select(c => c.Id).ToList()
        }, null, delete ? "delete" : "cancel");
    }

}
