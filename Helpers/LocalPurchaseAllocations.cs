using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// The one pool of local (non-inventory) purchase quantities. A sale line
    /// is purchased through PurchaseItem.LocalDeliveryItemId when it came from
    /// a challan, and through LocalInvoiceItemId only when the bill line is
    /// standalone — so the costing dialog and the Purchase Bill form spend the
    /// same remaining quantity and nothing is bought twice.
    /// </summary>
    public static class LocalPurchaseAllocations
    {
        /// <summary>One purchase line's claim on a source line.</summary>
        public record Claim(int? DeliveryItemId, int? InvoiceItemId, decimal Quantity);

        public static async Task<Dictionary<int, decimal>> PurchasedByDeliveryAsync(
            AppDbContext db, int companyId, IEnumerable<int> deliveryItemIds, int? excludeBillId = null)
        {
            var ids = deliveryItemIds.Distinct().ToList();
            if (ids.Count == 0) return new();
            return await db.PurchaseItems.AsNoTracking()
                .Where(p => p.LocalDeliveryItemId.HasValue && ids.Contains(p.LocalDeliveryItemId.Value)
                    && p.PurchaseBill.CompanyId == companyId && p.PurchaseBillId != excludeBillId)
                .GroupBy(p => p.LocalDeliveryItemId!.Value)
                .Select(g => new { Id = g.Key, Qty = g.Sum(p => p.Quantity) })
                .ToDictionaryAsync(x => x.Id, x => x.Qty);
        }

        public static async Task<Dictionary<int, decimal>> PurchasedByInvoiceAsync(
            AppDbContext db, int companyId, IEnumerable<int> invoiceItemIds, int? excludeBillId = null)
        {
            var ids = invoiceItemIds.Distinct().ToList();
            if (ids.Count == 0) return new();
            return await db.PurchaseItems.AsNoTracking()
                .Where(p => p.LocalInvoiceItemId.HasValue && ids.Contains(p.LocalInvoiceItemId.Value)
                    && p.PurchaseBill.CompanyId == companyId && p.PurchaseBillId != excludeBillId)
                .GroupBy(p => p.LocalInvoiceItemId!.Value)
                .Select(g => new { Id = g.Key, Qty = g.Sum(p => p.Quantity) })
                .ToDictionaryAsync(x => x.Id, x => x.Qty);
        }

        /// <summary>
        /// Row-locks the source lines in one global order (delivery lines, then
        /// standalone bill lines, ascending ids) so two saves cannot both spend
        /// the same remaining quantity. Must run inside a transaction.
        /// </summary>
        public static async Task LockAsync(AppDbContext db, IEnumerable<int> deliveryItemIds, IEnumerable<int> invoiceItemIds)
        {
            foreach (var id in deliveryItemIds.Distinct().OrderBy(x => x))
                await db.DeliveryItems.FromSqlInterpolated($"SELECT * FROM DeliveryItems WITH (UPDLOCK, HOLDLOCK, FORCESEEK) WHERE Id = {id}")
                    .AsNoTracking().Select(x => x.Id).ToListAsync();
            foreach (var id in invoiceItemIds.Distinct().OrderBy(x => x))
                await db.InvoiceItems.FromSqlInterpolated($"SELECT * FROM InvoiceItems WITH (UPDLOCK, HOLDLOCK, FORCESEEK) WHERE Id = {id}")
                    .AsNoTracking().Select(x => x.Id).ToListAsync();
        }

        /// <summary>
        /// Validates and normalises the links a LocalDirect purchase claims.
        /// A standalone-bill link to a line that came from a challan is moved to
        /// that challan line. Every source must belong to <paramref name="companyId"/>,
        /// be live (not demo, not cancelled, a sale rather than a note) and have
        /// enough quantity left after every OTHER bill's claims. Locks first.
        /// Returns the normalised claims in input order.
        /// </summary>
        public static async Task<List<Claim>> ValidateAsync(AppDbContext db, int companyId,
            IReadOnlyList<Claim> claims, int? excludeBillId = null)
        {
            if (claims.Any(c => c.DeliveryItemId.HasValue && c.InvoiceItemId.HasValue))
                throw new InvalidOperationException("A purchase line can be linked to only one source line.");
            var invoiceIds = claims.Where(c => c.InvoiceItemId.HasValue).Select(c => c.InvoiceItemId!.Value).Distinct().ToList();
            var invoiceLines = await db.InvoiceItems.AsNoTracking().Where(i => invoiceIds.Contains(i.Id))
                .Select(i => new { i.Id, i.DeliveryItemId, i.Quantity, i.Description, i.UOM, i.Invoice.CompanyId,
                    i.Invoice.IsDemo, i.Invoice.IsCancelled, i.Invoice.NoteKind, i.Invoice.InvoiceNumber })
                .ToDictionaryAsync(i => i.Id);
            if (invoiceLines.Count != invoiceIds.Count || invoiceLines.Values.Any(i => i.CompanyId != companyId || i.IsDemo || i.IsCancelled || i.NoteKind != 0))
                throw new InvalidOperationException("A selected bill line is unavailable for this company.");

            var normalised = claims.Select(c => c.InvoiceItemId.HasValue && invoiceLines[c.InvoiceItemId.Value].DeliveryItemId.HasValue
                ? new Claim(invoiceLines[c.InvoiceItemId.Value].DeliveryItemId, null, c.Quantity) : c).ToList();
            var deliveryIds = normalised.Where(c => c.DeliveryItemId.HasValue).Select(c => c.DeliveryItemId!.Value).ToList();
            var standaloneIds = normalised.Where(c => c.InvoiceItemId.HasValue).Select(c => c.InvoiceItemId!.Value).ToList();
            if (deliveryIds.Distinct().Count() != deliveryIds.Count || standaloneIds.Distinct().Count() != standaloneIds.Count)
                throw new InvalidOperationException("Use one purchase line per linked source line.");
            if (deliveryIds.Count + standaloneIds.Count == 0) return normalised;

            await LockAsync(db, deliveryIds, standaloneIds);
            var deliveryLines = await db.DeliveryItems.AsNoTracking().Where(i => deliveryIds.Contains(i.Id))
                .Select(i => new { i.Id, i.Quantity, i.Description, i.Unit, i.DeliveryChallan.CompanyId,
                    i.DeliveryChallan.IsDemo, i.DeliveryChallan.Status, i.DeliveryChallan.ChallanNumber })
                .ToDictionaryAsync(i => i.Id);
            if (deliveryLines.Count != deliveryIds.Count || deliveryLines.Values.Any(i => i.CompanyId != companyId || i.IsDemo || i.Status == "Cancelled"))
                throw new InvalidOperationException("A selected challan line is unavailable for this company.");

            var purchasedDelivery = await PurchasedByDeliveryAsync(db, companyId, deliveryIds, excludeBillId);
            var purchasedInvoice = await PurchasedByInvoiceAsync(db, companyId, standaloneIds, excludeBillId);
            foreach (var c in normalised)
            {
                if (c.DeliveryItemId is int d)
                {
                    var src = deliveryLines[d];
                    var remaining = Math.Max(0m, src.Quantity - purchasedDelivery.GetValueOrDefault(d));
                    if (c.Quantity > remaining)
                        throw new InvalidOperationException($"{src.Description}: only {remaining:0.####} {src.Unit} remains to purchase on challan #{src.ChallanNumber}.");
                }
                else if (c.InvoiceItemId is int b)
                {
                    var src = invoiceLines[b];
                    var remaining = Math.Max(0m, src.Quantity - purchasedInvoice.GetValueOrDefault(b));
                    if (c.Quantity > remaining)
                        throw new InvalidOperationException($"{src.Description}: only {remaining:0.####} {src.UOM} remains to purchase on bill #{src.InvoiceNumber}.");
                }
            }
            return normalised;
        }

        /// <summary>
        /// Refuses a sale-side edit that leaves a line holding less quantity than
        /// suppliers were already paid for. Call after the edit is saved and
        /// before the transaction commits; the throw rolls it back.
        /// </summary>
        public static async Task AssertSourcesCoverPurchasesAsync(AppDbContext db, int companyId, int invoiceId)
        {
            var lines = await db.InvoiceItems.AsNoTracking().Where(i => i.InvoiceId == invoiceId)
                .Select(i => new { i.Id, i.DeliveryItemId, i.Quantity, i.Description }).ToListAsync();
            var deliveryIds = lines.Where(l => l.DeliveryItemId.HasValue).Select(l => l.DeliveryItemId!.Value).ToList();
            var deliveryQty = await db.DeliveryItems.AsNoTracking().Where(d => deliveryIds.Contains(d.Id))
                .ToDictionaryAsync(d => d.Id, d => d.Quantity);
            var byDelivery = await PurchasedByDeliveryAsync(db, companyId, deliveryIds);
            var byInvoice = await PurchasedByInvoiceAsync(db, companyId, lines.Select(l => l.Id));
            foreach (var l in lines)
            {
                var purchased = l.DeliveryItemId is int d ? byDelivery.GetValueOrDefault(d) : byInvoice.GetValueOrDefault(l.Id);
                var held = l.DeliveryItemId is int d2 ? deliveryQty.GetValueOrDefault(d2) : l.Quantity;
                if (purchased > held)
                    throw new InvalidOperationException($"{l.Description}: {purchased:0.####} is already purchased from suppliers. Reduce or delete those supplier purchases before lowering this line below that quantity.");
            }
        }

        /// <summary>Refuses removing standalone bill lines that suppliers were paid for (the FK would otherwise fail the save with a 500).</summary>
        public static async Task AssertRemovableAsync(AppDbContext db, IEnumerable<int> removedInvoiceItemIds)
        {
            var ids = removedInvoiceItemIds.Distinct().ToList();
            if (ids.Count > 0 && await db.PurchaseItems.AnyAsync(p => p.LocalInvoiceItemId.HasValue && ids.Contains(p.LocalInvoiceItemId.Value)))
                throw new InvalidOperationException("A removed bill line has supplier purchases. Delete those supplier purchases first.");
        }
    }
}
