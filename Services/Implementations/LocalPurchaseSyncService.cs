using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Supplier and actual cost on a challan or standalone bill line ARE the
    /// local purchase. Every save calls one of the Sync methods, which keeps
    /// one automatic purchase bill per (source document, supplier) in step with
    /// those costs while it is unpaid and uncredited.
    ///
    /// "Fixed" purchases are everything else on a line: manual supplier bills
    /// from the Purchase Bill form and automatic bills that have been paid or
    /// credited. They are never changed here; the automatic bill only covers
    /// the quantity they leave, and a line may not shrink below them.
    /// </summary>
    public class LocalPurchaseSyncService(AppDbContext db, IPostingService posting, IGeneralLedgerService ledger)
    {
        public const string AutoSource = "auto-cost";

        private record Line(int? DeliveryId, int? InvoiceItemId, string Description, string Unit, decimal Quantity, int? SupplierId, decimal? Cost);

        /// <summary>Automatic bills whose lines still follow the source costs.</summary>
        public static IQueryable<PurchaseBill> OpenAuto(AppDbContext db) => db.PurchaseBills.Where(p => p.Source == AutoSource
            && p.AmountPaid == 0 && !db.PaymentAllocations.Any(a => a.PurchaseBillId == p.Id)
            && !db.PurchaseDebitNotes.Any(n => n.PurchaseBillId == p.Id));

        /// <summary>
        /// Refuses a costed line dated in a closed accounting period BEFORE a
        /// document is created, so the purchase can never fail after the
        /// document itself has been committed.
        /// </summary>
        public async Task AssertCanBookAsync(int companyId, DateTime date, bool anyCosted)
        {
            if (anyCosted) await ledger.AssertPeriodOpenAsync(companyId, date);
        }

        public async Task SyncChallanAsync(int challanId)
        {
            var c = await db.DeliveryChallans.AsNoTracking().Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == challanId);
            if (c == null) return;
            var released = c.IsDemo || c.Status == "Cancelled";
            await SyncAsync(c.CompanyId, challanId, null, (c.DeliveryDate ?? c.CreatedAt ?? DateTime.UtcNow).Date, $"challan #{c.ChallanNumber}",
                c.Items.Select(i => new Line(i.Id, null, i.Description, i.Unit, i.Quantity,
                    released ? null : i.SupplierId, released ? null : i.ActualUnitCost)).ToList());
        }

        /// <summary>A bill's own (standalone) lines; challan-backed lines belong to their challan.</summary>
        public async Task SyncBillAsync(int invoiceId)
        {
            var b = await db.Invoices.AsNoTracking().Include(x => x.Items)
                .FirstOrDefaultAsync(x => x.Id == invoiceId);
            if (b == null || b.NoteKind != 0) return;
            var released = b.IsDemo || b.IsCancelled;
            await SyncAsync(b.CompanyId, null, invoiceId, b.Date.Date, $"bill #{b.InvoiceNumber}",
                b.Items.Where(i => !i.DeliveryItemId.HasValue).Select(i => new Line(null, i.Id, i.Description, i.UOM, i.Quantity,
                    released ? null : i.SupplierId, released ? null : i.ActualUnitCost)).ToList());
        }

        /// <summary>Everything a bill's lines can reach: its challans and its standalone lines.</summary>
        public async Task SyncInvoiceSourcesAsync(int invoiceId)
        {
            var challans = await db.InvoiceItems.AsNoTracking().Where(i => i.InvoiceId == invoiceId && i.DeliveryItemId.HasValue)
                .Select(i => i.DeliveryItem!.DeliveryChallanId).Distinct().OrderBy(x => x).ToListAsync();
            foreach (var id in challans) await SyncChallanAsync(id);
            await SyncBillAsync(invoiceId);
        }

        /// <summary>
        /// Takes lines out of their open automatic bills before the lines are
        /// deleted (the link has no cascade). Refuses when a fixed purchase still
        /// points at one of them.
        /// </summary>
        public async Task ReleaseLinesAsync(int companyId, IEnumerable<int> deliveryIds, IEnumerable<int> invoiceItemIds)
        {
            var d = deliveryIds.Distinct().ToList();
            var b = invoiceItemIds.Distinct().ToList();
            if (d.Count + b.Count == 0) return;
            var ownTx = db.Database.CurrentTransaction == null ? await db.Database.BeginTransactionAsync() : null;
            try
            {
            await LocalPurchaseAllocations.LockAsync(db, d, b);
            var openIds = OpenAuto(db).Select(p => p.Id);
            var linked = db.PurchaseItems.Where(p => (p.LocalDeliveryItemId.HasValue && d.Contains(p.LocalDeliveryItemId.Value))
                || (p.LocalInvoiceItemId.HasValue && b.Contains(p.LocalInvoiceItemId.Value)));
            if (await linked.AnyAsync(p => !openIds.Contains(p.PurchaseBillId)))
                throw new InvalidOperationException("A line being removed is already on a paid, credited or manually entered supplier bill. Remove or credit that supplier bill first.");
            var bills = await OpenAuto(db).Include(p => p.Items)
                .Where(p => p.CompanyId == companyId && p.Items.Any(i => (i.LocalDeliveryItemId.HasValue && d.Contains(i.LocalDeliveryItemId.Value))
                    || (i.LocalInvoiceItemId.HasValue && b.Contains(i.LocalInvoiceItemId.Value))))
                .ToListAsync();
            foreach (var bill in bills)
            {
                var keep = bill.Items.Where(i => !(i.LocalDeliveryItemId.HasValue && d.Contains(i.LocalDeliveryItemId.Value))
                    && !(i.LocalInvoiceItemId.HasValue && b.Contains(i.LocalInvoiceItemId.Value))).ToList();
                if (keep.Count == 0) await DeleteBillAsync(bill);
                else await ReplaceItemsAsync(bill, keep.Select(Copy).ToList(), bill.Date);
            }
            if (ownTx != null) await ownTx.CommitAsync();
            }
            finally
            {
                if (ownTx != null) await ownTx.DisposeAsync();
            }
        }

        /// <summary>Quantity each line holds on fixed purchases (manual, paid or credited).</summary>
        public async Task<(Dictionary<int, decimal> ByDelivery, Dictionary<int, decimal> ByInvoice)> FixedAsync(
            int companyId, IEnumerable<int> deliveryIds, IEnumerable<int> invoiceItemIds)
        {
            var d = deliveryIds.Distinct().ToList();
            var b = invoiceItemIds.Distinct().ToList();
            var openIds = OpenAuto(db).Select(p => p.Id);
            var rows = await db.PurchaseItems.AsNoTracking()
                .Where(p => p.PurchaseBill.CompanyId == companyId && !openIds.Contains(p.PurchaseBillId)
                    && ((p.LocalDeliveryItemId.HasValue && d.Contains(p.LocalDeliveryItemId.Value))
                        || (p.LocalInvoiceItemId.HasValue && b.Contains(p.LocalInvoiceItemId.Value))))
                .Select(p => new { p.LocalDeliveryItemId, p.LocalInvoiceItemId, p.Quantity }).ToListAsync();
            return (rows.Where(r => r.LocalDeliveryItemId.HasValue).GroupBy(r => r.LocalDeliveryItemId!.Value).ToDictionary(g => g.Key, g => g.Sum(r => r.Quantity)),
                    rows.Where(r => r.LocalInvoiceItemId.HasValue).GroupBy(r => r.LocalInvoiceItemId!.Value).ToDictionary(g => g.Key, g => g.Sum(r => r.Quantity)));
        }

        private async Task SyncAsync(int companyId, int? challanId, int? invoiceId, DateTime date, string label, List<Line> lines)
        {
            var ownTx = db.Database.CurrentTransaction == null ? await db.Database.BeginTransactionAsync() : null;
            try
            {
                var deliveryIds = lines.Where(l => l.DeliveryId.HasValue).Select(l => l.DeliveryId!.Value).ToList();
                var invoiceIds = lines.Where(l => l.InvoiceItemId.HasValue).Select(l => l.InvoiceItemId!.Value).ToList();
                await LocalPurchaseAllocations.LockAsync(db, deliveryIds, invoiceIds);
                var open = await OpenAuto(db).Include(p => p.Items)
                    .Where(p => p.CompanyId == companyId && (challanId.HasValue
                        ? p.SourceDeliveryChallanId == challanId
                        : p.SourceInvoiceId == invoiceId && p.SourceDeliveryChallanId == null))
                    .OrderBy(p => p.Id).ToListAsync();
                var (fixedD, fixedB) = await FixedAsync(companyId, deliveryIds, invoiceIds);
                decimal Fixed(Line l) => l.DeliveryId is int d ? fixedD.GetValueOrDefault(d) : fixedB.GetValueOrDefault(l.InvoiceItemId ?? 0);
                var short_ = lines.FirstOrDefault(l => Fixed(l) > l.Quantity);
                if (short_ != null)
                    throw new InvalidOperationException($"{short_.Description}: {Fixed(short_):0.####} {short_.Unit} is already on a paid, credited or manually entered supplier bill. Keep at least that quantity, or correct that supplier bill first.");

                var wanted = lines.Where(l => l.SupplierId.HasValue && l.Cost.HasValue && l.Quantity - Fixed(l) > 0)
                    .GroupBy(l => l.SupplierId!.Value)
                    .ToDictionary(g => g.Key, g => g.Select(l => new PurchaseItem {
                        Description = l.Description, UOM = l.Unit, Quantity = l.Quantity - Fixed(l), UnitPrice = l.Cost!.Value,
                        LineTotal = Math.Round((l.Quantity - Fixed(l)) * l.Cost.Value, 2),
                        LocalDeliveryItemId = l.DeliveryId, LocalInvoiceItemId = l.InvoiceItemId }).ToList());
                var supplierIds = wanted.Keys.ToList();
                if (await db.Suppliers.CountAsync(s => s.CompanyId == companyId && supplierIds.Contains(s.Id)) != supplierIds.Count)
                    throw new InvalidOperationException("A selected supplier does not belong to this company.");

                foreach (var supplierId in supplierIds.Union(open.Select(p => p.SupplierId)).OrderBy(x => x).ToList())
                {
                    var bills = open.Where(p => p.SupplierId == supplierId).ToList();
                    if (!wanted.TryGetValue(supplierId, out var items))
                    {
                        foreach (var bill in bills) await DeleteBillAsync(bill);
                        continue;
                    }
                    foreach (var extra in bills.Skip(1)) await DeleteBillAsync(extra);
                    var keep = bills.FirstOrDefault();
                    if (keep == null) await CreateBillAsync(companyId, supplierId, challanId, invoiceId, date, label, items);
                    else if (!Same(keep, items, date)) await ReplaceItemsAsync(keep, items, date);
                }
                if (ownTx != null) await ownTx.CommitAsync();
            }
            finally
            {
                if (ownTx != null) await ownTx.DisposeAsync();
            }
        }

        private static PurchaseItem Copy(PurchaseItem i) => new() { Description = i.Description, UOM = i.UOM, Quantity = i.Quantity,
            UnitPrice = i.UnitPrice, LineTotal = i.LineTotal, LocalDeliveryItemId = i.LocalDeliveryItemId, LocalInvoiceItemId = i.LocalInvoiceItemId };

        private static string Key(PurchaseItem i) => $"{i.LocalDeliveryItemId}|{i.LocalInvoiceItemId}|{i.Quantity:0.####}|{i.UnitPrice:0.####}|{i.Description}|{i.UOM}";

        private static bool Same(PurchaseBill bill, List<PurchaseItem> items, DateTime date) =>
            bill.Date.Date == date.Date && bill.Items.Select(Key).OrderBy(k => k).SequenceEqual(items.Select(Key).OrderBy(k => k));

        private async Task CreateBillAsync(int companyId, int supplierId, int? challanId, int? invoiceId, DateTime date, string label, List<PurchaseItem> items)
        {
            var bill = new PurchaseBill { CompanyId = companyId, SupplierId = supplierId, Source = AutoSource, PurchaseCategory = "LocalDirect",
                SourceDeliveryChallanId = challanId, SourceInvoiceId = invoiceId, Date = date.Date, GSTRate = 0,
                PurchaseBillNumber = await CompanyDocumentNumbers.AllocateAsync(db, companyId, "purchase-bill"),
                ReconciliationStatus = "ManualOnly", Notes = $"Supplier cost from {label}", CreatedAt = DateTime.UtcNow, Items = items };
            Total(bill);
            db.PurchaseBills.Add(bill);
            await db.SaveChangesAsync();
            await posting.PostPurchaseBillAsync(bill);
        }

        private async Task ReplaceItemsAsync(PurchaseBill bill, List<PurchaseItem> items, DateTime date)
        {
            db.PurchaseItems.RemoveRange(bill.Items);
            bill.Items.Clear();
            foreach (var i in items) bill.Items.Add(i);
            bill.Date = date.Date;
            Total(bill);
            await db.SaveChangesAsync();
            await posting.PostPurchaseBillAsync(bill);
        }

        private async Task DeleteBillAsync(PurchaseBill bill)
        {
            await posting.RemoveForSourceAsync(bill.CompanyId, SourceDocType.PurchaseBill, bill.Id);
            db.PurchaseBills.Remove(bill);
            await db.SaveChangesAsync();
        }

        /// <summary>Same arithmetic as a saved purchase bill; the header GST and withholding the user chose are kept.</summary>
        public static void Total(PurchaseBill bill)
        {
            bill.Subtotal = bill.Items.Sum(i => i.LineTotal);
            bill.GSTAmount = Math.Round(bill.Subtotal * bill.GSTRate / 100m, 2);
            bill.GrandTotal = bill.Subtotal + bill.GSTAmount;
            bill.WithholdingTaxAmount = WithholdingTaxCalculator.Resolve(bill.WithholdingTaxRate, bill.GrandTotal, bill.WithholdingTaxAmount);
            bill.AmountInWords = NumberToWordsConverter.Convert(bill.GrandTotal);
        }
    }
}
