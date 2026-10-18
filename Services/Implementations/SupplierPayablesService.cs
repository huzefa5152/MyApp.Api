using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models.Accounting;

namespace MyApp.Api.Services.Implementations;

public class SupplierPayablesService(AppDbContext db)
{
    public async Task<List<SupplierPayableSummaryDto>> SummaryAsync(int companyId, DateTime? asOf)
    {
        var end = (asOf ?? PakistanClock.Today).Date.AddDays(1);
        var rows = await db.Suppliers.AsNoTracking().Where(s => s.CompanyId == companyId).OrderBy(s => s.Name)
            .Select(s => new SupplierPayableSummaryDto { SupplierId = s.Id, SupplierName = s.Name }).ToListAsync();
        var purchases = await db.PurchaseBills.AsNoTracking().Where(p => p.CompanyId == companyId && p.Date < end)
            .GroupBy(p => p.SupplierId).Select(g => new { Id = g.Key, Total = g.Sum(p => p.GrandTotal - p.WithholdingTaxAmount) }).ToDictionaryAsync(g => g.Id);
        var paid = await db.PaymentAllocations.AsNoTracking().Where(a => a.Payment.CompanyId == companyId && a.Payment.ContactType == "Supplier" &&
            a.Payment.ContactId.HasValue && !a.Payment.IsCancelled && a.Payment.ChequeStatus != ChequeStatus.Bounced && a.Payment.Date < end &&
            (a.Kind == AllocationKind.OnAccount || a.Kind == AllocationKind.Document && a.PurchaseBillId.HasValue))
            .Select(a => new { Id = a.Payment.ContactId!.Value, Sign = a.Payment.Direction == PaymentDirection.Payment ? 1m : -1m,
                a.Amount, a.AdjustmentAmount, Advance = a.Kind == AllocationKind.OnAccount }).ToListAsync();
        var credits = await db.PurchaseDebitNotes.AsNoTracking().Where(n => n.CompanyId == companyId && n.Date < end)
            .GroupBy(n => n.SupplierId).Select(g => new { Id = g.Key, Total = g.Sum(n => n.GrandTotal), Unallocated = g.Sum(n => n.PurchaseBillId == null ? n.GrandTotal : 0m) }).ToDictionaryAsync(g => g.Id);
        var journals = await db.JournalLines.AsNoTracking().Where(l => l.JournalEntry.CompanyId == companyId && l.JournalEntry.Date < end &&
            l.JournalEntry.SourceDocType == SourceDocType.ManualJournal && l.PartyType == "Supplier" && l.PartyId.HasValue && l.Account.ControlType == ControlType.AccountsPayable)
            .GroupBy(l => l.PartyId!.Value).Select(g => new { Id = g.Key, Total = g.Sum(l => l.Credit - l.Debit) }).ToDictionaryAsync(g => g.Id);
        var bySupplier = paid.ToLookup(p => p.Id);
        foreach (var row in rows)
        {
            var payments = bySupplier[row.SupplierId];
            row.Purchases = purchases.GetValueOrDefault(row.SupplierId)?.Total ?? 0;
            row.CashPaid = payments.Sum(p => p.Sign * p.Amount);
            row.OtherSettlement = payments.Sum(p => p.Sign * p.AdjustmentAmount);
            row.UnappliedAdvances = payments.Where(p => p.Advance).Sum(p => p.Sign * (p.Amount + p.AdjustmentAmount));
            row.TotalCredits = credits.GetValueOrDefault(row.SupplierId)?.Total ?? 0;
            row.UnallocatedCredits = credits.GetValueOrDefault(row.SupplierId)?.Unallocated ?? 0;
            row.NetBalance = row.Purchases - row.CashPaid - row.OtherSettlement - row.TotalCredits + (journals.GetValueOrDefault(row.SupplierId)?.Total ?? 0);
        }
        return rows;
    }

    public async Task<SupplierLedgerDto?> LedgerAsync(int companyId, int supplierId, DateTime? from, DateTime? asOf)
    {
        var supplier = await db.Suppliers.AsNoTracking().SingleOrDefaultAsync(s => s.CompanyId == companyId && s.Id == supplierId);
        if (supplier == null) return null;
        var end = (asOf ?? PakistanClock.Today).Date.AddDays(1);
        var result = new SupplierLedgerDto { SupplierId = supplierId, SupplierName = supplier.Name };
        var purchases = await db.PurchaseBills.AsNoTracking().Include(p => p.Items)
            .Where(p => p.CompanyId == companyId && p.SupplierId == supplierId && p.Date < end).ToListAsync();
        var payments = await db.Payments.AsNoTracking().Include(p => p.Allocations)
            .Where(p => p.CompanyId == companyId && p.ContactType == "Supplier" && p.ContactId == supplierId &&
                !p.IsCancelled && p.ChequeStatus != ChequeStatus.Bounced && p.Date < end).ToListAsync();
        var invoiceLines = await db.InvoiceItems.AsNoTracking().Where(i => i.Invoice.CompanyId == companyId)
            .Select(i => new { i.Id, i.InvoiceId, i.Invoice.InvoiceNumber, i.DeliveryItemId, i.ActualUnitCost, i.SupplierId }).ToListAsync();
        var deliveryLines = await db.DeliveryItems.AsNoTracking().Where(i => i.DeliveryChallan.CompanyId == companyId)
            .Select(i => new { i.Id, i.DeliveryChallanId, i.DeliveryChallan.ChallanNumber, i.DeliveryChallan.InvoiceId, i.ActualUnitCost, i.SupplierId }).ToListAsync();
        var credits = await db.PurchaseDebitNotes.AsNoTracking().Where(n => n.CompanyId == companyId && n.SupplierId == supplierId && n.Date < end).ToListAsync();
        foreach (var p in purchases)
        {
            var allocations = payments.Where(x => x.Direction == PaymentDirection.Payment).SelectMany(x => x.Allocations)
                .Where(a => a.Kind == AllocationKind.Document && a.PurchaseBillId == p.Id).ToList();
            var sourceDeliveries = deliveryLines.Where(d => p.SourceDeliveryChallanId == d.DeliveryChallanId || p.Items.Any(i => i.LocalDeliveryItemId == d.Id)).ToList();
            var ids = sourceDeliveries.Where(d => d.InvoiceId.HasValue).Select(d => d.InvoiceId!.Value)
                .Concat(p.SourceInvoiceId.HasValue ? new[] { p.SourceInvoiceId.Value } : Array.Empty<int>())
                .Concat(invoiceLines.Where(i => p.Items.Any(x => x.LocalInvoiceItemId == i.Id)).Select(i => i.InvoiceId)).Distinct().ToList();
            var row = new SupplierPurchaseBalanceDto { Id = p.Id, Number = p.PurchaseBillNumber, SupplierId = supplierId, SupplierName = supplier.Name,
                SupplierBillNumber = p.SupplierBillNumber,
                Category = p.Source == "challan-supplier" ? "LocalDirect" : p.PurchaseCategory, Date = p.Date,
                Liability = p.GrandTotal - p.WithholdingTaxAmount, CreditAmount = credits.Where(n => n.PurchaseBillId == p.Id).Sum(n => n.GrandTotal), CashPaid = allocations.Sum(a => a.Amount), Adjustment = allocations.Sum(a => a.AdjustmentAmount),
                InvoiceIds = ids, InvoiceNumbers = ids.Select(id => invoiceLines.First(i => i.InvoiceId == id).InvoiceNumber).ToList(),
                ChallanIds = sourceDeliveries.Select(d => d.DeliveryChallanId).Distinct().ToList(),
                ChallanNumbers = sourceDeliveries.GroupBy(d => d.DeliveryChallanId).Select(g => g.First().ChallanNumber).ToList(),
                // A line split across suppliers is normal; flag only when this
                // supplier's estimate moved away from the price booked here.
                CostChanged = p.Items.Any(i => i.LocalDeliveryItemId.HasValue && sourceDeliveries.Any(d => d.Id == i.LocalDeliveryItemId && d.SupplierId == p.SupplierId && d.ActualUnitCost != i.UnitPrice) ||
                    i.LocalInvoiceItemId.HasValue && invoiceLines.Any(d => d.Id == i.LocalInvoiceItemId && d.SupplierId == p.SupplierId && d.ActualUnitCost != i.UnitPrice)) };
            result.Purchases.Add(row);
            result.Rows.Add(new() { Date = p.Date, CreatedAt = p.CreatedAt, Kind = "Purchase", Id = p.Id, Reference = $"Purchase #{p.PurchaseBillNumber}", Increase = row.Liability, PurchaseBillIds = new() { p.Id } });
        }
        foreach (var p in payments)
        {
            var direction = p.Direction == PaymentDirection.Payment ? 1m : -1m;
            var relevant = p.Allocations.Where(a => a.Kind == AllocationKind.OnAccount || a.Kind == AllocationKind.Document && a.PurchaseBillId.HasValue).ToList();
            var cash = direction * relevant.Sum(a => a.Amount);
            var adjustment = direction * relevant.Sum(a => a.AdjustmentAmount);
            result.CashPaid += cash;
            result.UnappliedAdvances += direction * relevant.Where(a => a.Kind == AllocationKind.OnAccount).Sum(a => a.Amount + a.AdjustmentAmount);
            result.Rows.Add(new() { Date = p.Date, CreatedAt = p.CreatedAt, Kind = p.Direction == PaymentDirection.Payment ? "Payment" : "Supplier refund", Id = p.Id, Reference = $"{p.Direction} #{p.Number}",
                CashPaid = cash, Adjustment = adjustment, PurchaseBillIds = relevant.Where(a => a.PurchaseBillId.HasValue).Select(a => a.PurchaseBillId!.Value).Distinct().ToList() });
        }

        foreach (var n in credits)
        {
            if (!n.PurchaseBillId.HasValue) result.UnallocatedCredits += n.GrandTotal;
            result.Rows.Add(new() { Date = n.Date, CreatedAt = n.CreatedAt, Kind = "Supplier credit", Id = n.Id, Reference = $"Supplier debit note #{n.DebitNoteNumber}", Adjustment = n.GrandTotal, PurchaseBillIds = n.PurchaseBillId.HasValue ? new() { n.PurchaseBillId.Value } : new() });
        }
        var manual = await db.JournalLines.AsNoTracking().Where(l => l.JournalEntry.CompanyId == companyId &&
            l.JournalEntry.SourceDocType == SourceDocType.ManualJournal && l.PartyType == "Supplier" && l.PartyId == supplierId &&
            l.Account.ControlType == ControlType.AccountsPayable && l.JournalEntry.Date < end)
            .Select(l => new { l.JournalEntryId, l.JournalEntry.Date, l.JournalEntry.CreatedAt, l.JournalEntry.EntryNo, l.Credit, l.Debit }).ToListAsync();
        foreach (var m in manual)
            result.Rows.Add(new() { Date = m.Date, CreatedAt = m.CreatedAt, Kind = "Journal", Id = m.JournalEntryId, Reference = $"Journal #{m.EntryNo}", Increase = m.Credit, Adjustment = m.Debit });
        decimal running = 0;
        result.Rows = result.Rows.OrderBy(r => r.Date).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id).ToList();
        foreach (var r in result.Rows) { running += r.Increase - r.CashPaid - r.Adjustment; r.Balance = running; }
        result.NetBalance = running;
        if (from.HasValue)
        {
            result.OpeningBalance = result.Rows.Where(r => r.Date.Date < from.Value.Date).Sum(r => r.Increase - r.CashPaid - r.Adjustment);
            result.Rows = result.Rows.Where(r => r.Date.Date >= from.Value.Date).ToList();
        }
        return result;
    }
}
