using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// Derived inventory read model (2026-07 redesign). Physical OnHand comes
    /// from the immutable StockMovement ledger (via IStockService, the tested
    /// on-hand math); the logical buckets are computed here from live document
    /// state so they can never drift:
    ///
    ///   ToDeliver = Σ over open Sales-Order lines of
    ///               max(ordered − delivered − directInvoiced, 0)
    ///   Delivered = Σ challan-line qty on non-cancelled, un-billed challans
    ///   Committed = ToDeliver + Delivered
    ///   Available = OnHand − Committed
    ///   Incoming  = Σ goods-receipt-line qty on non-cancelled, un-billed GRs
    ///
    /// A billed challan drops out of Delivered (its InvoiceId is set) exactly
    /// as the bill records the physical OUT — no double count. Cancelled SOs
    /// release their reservation, cancelled challans/GRs drop out, all by
    /// virtue of the WHERE clauses below.
    /// </summary>
    public class InventoryReadService : IInventoryReadService
    {
        private readonly AppDbContext _context;
        private readonly IStockService _stock;

        public InventoryReadService(AppDbContext context, IStockService stock)
        {
            _context = context;
            _stock = stock;
        }

        public async Task<decimal> GetAvailableAsync(
            int companyId, int itemTypeId, HashSet<int>? allowedDivisionIds = null)
        {
            var rows = await GetBucketsAsync(companyId, new[] { itemTypeId }, allowedDivisionIds);
            return rows.FirstOrDefault()?.Available ?? 0m;
        }

        public async Task<List<InventoryBucketRow>> GetBucketsAsync(
            int companyId,
            IEnumerable<int>? itemTypeIds = null,
            HashSet<int>? allowedDivisionIds = null)
        {
            // ── 1. Candidate item-type set ────────────────────────────────
            List<int> ids;
            if (itemTypeIds != null)
            {
                ids = itemTypeIds.Where(i => i > 0).Distinct().ToList();
            }
            else
            {
                // Every item with any inventory footprint. Items with none
                // return all-zero buckets, so this bounds the work to the
                // operationally-relevant set (the UI merges the full catalog).
                var openIds = await _context.OpeningStockBalances
                    .Where(o => o.CompanyId == companyId).Select(o => o.ItemTypeId).ToListAsync();
                var movIds = await _context.StockMovements
                    .Where(m => m.CompanyId == companyId).Select(m => m.ItemTypeId).ToListAsync();
                var soIds = await _context.SalesOrderItems
                    .Where(si => si.SalesOrder.CompanyId == companyId
                              && si.SalesOrder.Status != "Cancelled" && si.SalesOrder.Status != "Closed"
                              && si.ItemTypeId != null)
                    .Select(si => si.ItemTypeId!.Value).ToListAsync();
                var chIds = await _context.DeliveryItems
                    .Where(di => di.DeliveryChallan.CompanyId == companyId
                              && di.DeliveryChallan.InvoiceId == null
                              && di.DeliveryChallan.Status != "Cancelled"
                              && !di.DeliveryChallan.IsDemo
                              && di.ItemTypeId != null)
                    .Select(di => di.ItemTypeId!.Value).ToListAsync();
                var grIds = await _context.Set<GoodsReceiptItem>()
                    .Where(gi => gi.GoodsReceipt.CompanyId == companyId
                              && gi.GoodsReceipt.PurchaseBillId == null
                              && gi.GoodsReceipt.Status != "Cancelled"
                              && gi.ItemTypeId != null)
                    .Select(gi => gi.ItemTypeId!.Value).ToListAsync();
                ids = openIds.Concat(movIds).Concat(soIds).Concat(chIds).Concat(grIds)
                    .Distinct().ToList();
            }
            if (ids.Count == 0) return new List<InventoryBucketRow>();

            // ── 2. Catalog rows (skip soft-deleted) + tracked set ─────────
            var itemTypes = await _context.ItemTypes
                .Where(it => ids.Contains(it.Id) && !it.IsDeleted)
                .ToDictionaryAsync(it => it.Id);
            ids = ids.Where(itemTypes.ContainsKey).ToList();
            if (ids.Count == 0) return new List<InventoryBucketRow>();

            var trackedSet = await _stock.GetStockTrackedItemTypeIdsAsync(companyId, ids);

            // ── 3. Physical on-hand (ledger, division-scoped) ─────────────
            var onHand = await _stock.GetOnHandBulkAsync(companyId, ids, null, allowedDivisionIds);

            // ── 4. Delivered (un-billed, non-cancelled challan lines) ─────
            var deliveredQ = _context.DeliveryItems
                .Where(di => di.DeliveryChallan.CompanyId == companyId
                          && di.DeliveryChallan.InvoiceId == null
                          && di.DeliveryChallan.Status != "Cancelled"
                          && !di.DeliveryChallan.IsDemo
                          && di.ItemTypeId != null
                          && ids.Contains(di.ItemTypeId!.Value));
            if (allowedDivisionIds != null)
                deliveredQ = deliveredQ.Where(di => di.DeliveryChallan.DivisionId == null
                    || allowedDivisionIds.Contains(di.DeliveryChallan.DivisionId!.Value));
            var delivered = (await deliveredQ
                .GroupBy(di => di.ItemTypeId!.Value)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(x => x.Quantity) })
                .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.Qty);

            // ── 5. Incoming (un-billed, non-cancelled goods-receipt lines) ─
            var incomingQ = _context.Set<GoodsReceiptItem>()
                .Where(gi => gi.GoodsReceipt.CompanyId == companyId
                          && gi.GoodsReceipt.PurchaseBillId == null
                          && gi.GoodsReceipt.Status != "Cancelled"
                          && gi.ItemTypeId != null
                          && ids.Contains(gi.ItemTypeId!.Value));
            if (allowedDivisionIds != null)
                incomingQ = incomingQ.Where(gi => gi.GoodsReceipt.DivisionId == null
                    || allowedDivisionIds.Contains(gi.GoodsReceipt.DivisionId!.Value));
            var incoming = (await incomingQ
                .GroupBy(gi => gi.ItemTypeId!.Value)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(x => (decimal)x.Quantity) })
                .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.Qty);

            // ── 6. ToDeliver — per open Sales-Order line ──────────────────
            // ordered − delivered(challan links) − directInvoiced(invoice links),
            // floored at 0, then summed per item type. Delivered/directInvoiced
            // are computed per SalesOrderItem, so partial fulfilment across
            // several challans/invoices nets correctly.
            var openSoLinesQ = _context.SalesOrderItems
                .Where(si => si.SalesOrder.CompanyId == companyId
                          && si.SalesOrder.Status != "Cancelled" && si.SalesOrder.Status != "Closed"
                          && si.ItemTypeId != null
                          && ids.Contains(si.ItemTypeId!.Value));
            if (allowedDivisionIds != null)
                openSoLinesQ = openSoLinesQ.Where(si => si.SalesOrder.DivisionId == null
                    || allowedDivisionIds.Contains(si.SalesOrder.DivisionId!.Value));
            var openSoLines = await openSoLinesQ
                .Select(si => new { si.Id, si.ItemTypeId, si.Quantity })
                .ToListAsync();

            var toDeliver = new Dictionary<int, decimal>();
            if (openSoLines.Count > 0)
            {
                var soLineIds = openSoLines.Select(l => l.Id).ToList();

                // Delivered per SO line (challan lines, non-cancelled challans).
                var deliveredPerLine = (await _context.DeliveryItems
                        .Where(di => di.SalesOrderItemId != null
                                  && soLineIds.Contains(di.SalesOrderItemId!.Value)
                                  && di.DeliveryChallan.Status != "Cancelled")
                        .GroupBy(di => di.SalesOrderItemId!.Value)
                        .Select(g => new { LineId = g.Key, Qty = g.Sum(x => x.Quantity) })
                        .ToListAsync())
                    .ToDictionary(x => x.LineId, x => x.Qty);

                // Directly-invoiced per SO line (bills linked straight to the
                // order without a challan — via InvoiceItem.SalesOrderItemId).
                // Excludes cancelled / FBR-excluded bills.
                var directInvPerLine = (await _context.InvoiceItems
                        .Where(ii => ii.SalesOrderItemId != null
                                  && soLineIds.Contains(ii.SalesOrderItemId!.Value)
                                  && !ii.Invoice.IsCancelled
                                  && !ii.Invoice.IsFbrExcluded
                                  && ii.DeliveryItemId == null) // challan-linked lines already counted under Delivered
                        .GroupBy(ii => ii.SalesOrderItemId!.Value)
                        .Select(g => new { LineId = g.Key, Qty = g.Sum(x => x.Quantity) })
                        .ToListAsync())
                    .ToDictionary(x => x.LineId, x => x.Qty);

                foreach (var line in openSoLines)
                {
                    var del = deliveredPerLine.GetValueOrDefault(line.Id);
                    var inv = directInvPerLine.GetValueOrDefault(line.Id);
                    var remaining = line.Quantity - del - inv;
                    if (remaining < 0m) remaining = 0m;
                    if (remaining == 0m) continue;
                    var itemId = line.ItemTypeId!.Value;
                    toDeliver.TryGetValue(itemId, out var cur);
                    toDeliver[itemId] = cur + remaining;
                }
            }

            // ── 7. Last movement date (for the summary) ───────────────────
            var lastMove = (await _context.StockMovements
                    .Where(m => m.CompanyId == companyId && ids.Contains(m.ItemTypeId))
                    .GroupBy(m => m.ItemTypeId)
                    .Select(g => new { ItemTypeId = g.Key, Last = g.Max(m => m.MovementDate) })
                    .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.Last);

            // ── 8. Reorder levels ─────────────────────────────────────────
            var reorder = (await _context.CompanyItemTypeSettings
                    .Where(s => s.CompanyId == companyId && ids.Contains(s.ItemTypeId) && s.ReorderLevel != null)
                    .Select(s => new { s.ItemTypeId, s.ReorderLevel })
                    .ToListAsync())
                .ToDictionary(x => x.ItemTypeId, x => x.ReorderLevel);

            // ── 9. Assemble ───────────────────────────────────────────────
            var rows = new List<InventoryBucketRow>();
            foreach (var id in ids)
            {
                var it = itemTypes[id];
                var oh = onHand.GetValueOrDefault(id);
                var td = toDeliver.GetValueOrDefault(id);
                var dl = delivered.GetValueOrDefault(id);
                var committed = td + dl;
                rows.Add(new InventoryBucketRow
                {
                    ItemTypeId = id,
                    ItemTypeName = it.Name,
                    HSCode = it.HSCode,
                    UOM = it.UOM,
                    Tracked = trackedSet.Contains(id),
                    OnHand = oh,
                    ToDeliver = td,
                    Delivered = dl,
                    Committed = committed,
                    Available = oh - committed,
                    Incoming = incoming.GetValueOrDefault(id),
                    ReorderLevel = reorder.GetValueOrDefault(id),
                    LastMovementAt = lastMove.TryGetValue(id, out var d) ? d : null,
                });
            }
            return rows.OrderBy(r => r.ItemTypeName).ToList();
        }
    }
}
