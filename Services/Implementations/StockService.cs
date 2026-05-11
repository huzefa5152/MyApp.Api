using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class StockService : IStockService
    {
        private readonly AppDbContext _context;
        private readonly ILogger<StockService> _logger;

        public StockService(AppDbContext context, ILogger<StockService> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task<bool> IsTrackingEnabledAsync(int companyId)
        {
            return await _context.Companies
                .Where(c => c.Id == companyId)
                .Select(c => c.InventoryTrackingEnabled)
                .FirstOrDefaultAsync();
        }

        /// <summary>
        /// Inserts a StockMovement row. Audit C-5 (2026-05-08): the inner
        /// SaveChangesAsync is intentional — it makes the row visible to
        /// the surrounding transaction immediately so subsequent reads
        /// (e.g. on-hand checks) see consistent state. All callers run
        /// inside their own BeginTransactionAsync block; failure here
        /// rolls back atomically with the parent bill / receipt.
        ///
        /// Future work (audit H-1): wrap this SaveChanges in a Polly
        /// retry policy keyed on SqlException 1205 (deadlock). Today a
        /// deadlock here aborts the whole bill creation. Out of scope
        /// for the C-2/C-4/C-5 batch.
        /// </summary>
        public async Task RecordMovementAsync(
            int companyId,
            int itemTypeId,
            StockMovementDirection direction,
            decimal quantity,
            StockMovementSourceType sourceType,
            int? sourceId,
            DateTime movementDate,
            string? notes = null)
        {
            if (quantity <= 0m) return;
            if (!await IsTrackingEnabledAsync(companyId)) return;

            _context.StockMovements.Add(new StockMovement
            {
                CompanyId = companyId,
                ItemTypeId = itemTypeId,
                Direction = direction,
                Quantity = quantity,
                SourceType = sourceType,
                SourceId = sourceId,
                MovementDate = movementDate,
                Notes = notes,
                CreatedAt = DateTime.UtcNow,
            });

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                // Surface a structured log line before letting the caller's
                // outer transaction roll back. Pre-fix this was silent —
                // the caller's catch was the only trail.
                _logger.LogError(ex,
                    "StockMovement insert failed for company={CompanyId} item={ItemTypeId} dir={Direction} qty={Qty} source={SourceType}#{SourceId}",
                    companyId, itemTypeId, direction, quantity, sourceType, sourceId);
                throw;
            }
        }

        public async Task<decimal> GetOnHandAsync(int companyId, int itemTypeId, DateTime? asOfDate = null)
        {
            var dict = await GetOnHandBulkAsync(companyId, new[] { itemTypeId }, asOfDate);
            return dict.TryGetValue(itemTypeId, out var qty) ? qty : 0m;
        }

        public async Task<Dictionary<int, decimal>> GetOnHandBulkAsync(
            int companyId,
            IEnumerable<int> itemTypeIds,
            DateTime? asOfDate = null)
        {
            var ids = itemTypeIds?.Distinct().ToList() ?? new List<int>();
            if (ids.Count == 0) return new Dictionary<int, decimal>();

            // Opening balances bucketed by item type — these are unconditional,
            // they exist independent of tracking-enabled. The flag only gates
            // *writes*, not reads, so the dashboard works the moment a company
            // turns tracking on (given the opening balances are already entered).
            var openingQ = _context.OpeningStockBalances
                .Where(o => o.CompanyId == companyId && ids.Contains(o.ItemTypeId));
            if (asOfDate.HasValue)
                openingQ = openingQ.Where(o => o.AsOfDate <= asOfDate.Value);
            var openings = await openingQ
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Qty);

            // Net of In − Out from the movement log.
            var movQ = _context.StockMovements
                .Where(m => m.CompanyId == companyId && ids.Contains(m.ItemTypeId));
            if (asOfDate.HasValue)
                movQ = movQ.Where(m => m.MovementDate <= asOfDate.Value);
            var moves = await movQ
                .GroupBy(m => new { m.ItemTypeId, m.Direction })
                .Select(g => new { g.Key.ItemTypeId, g.Key.Direction, Qty = g.Sum(m => m.Quantity) })
                .ToListAsync();

            var result = new Dictionary<int, decimal>();
            foreach (var id in ids)
            {
                decimal onHand = openings.TryGetValue(id, out var op) ? op : 0m;
                foreach (var m in moves.Where(x => x.ItemTypeId == id))
                {
                    onHand += m.Direction == StockMovementDirection.In ? m.Qty : -m.Qty;
                }
                result[id] = onHand;
            }
            return result;
        }

        public async Task SyncInvoiceStockMovementsAsync(Invoice invoice)
        {
            if (invoice == null) return;
            if (!await IsTrackingEnabledAsync(invoice.CompanyId)) return;

            // Delete any prior Out movements emitted for this invoice. The
            // re-insert below uses the current Items, so any item-line
            // qty change, item-type swap, or line deletion since the
            // last save is automatically reflected.
            //
            // Append-only-log purity is sacrificed here intentionally —
            // an invoice's edit history is already captured in
            // AuditLog.Invoice.NarrowEdit / Invoice.Update entries, so
            // we don't need a second audit trail in StockMovements.
            // Keeping movements scoped 1:1 with the invoice's *current*
            // state keeps on-hand math simple and avoids stale rows
            // accumulating per edit.
            var stale = await _context.StockMovements
                .Where(m => m.CompanyId  == invoice.CompanyId
                         && m.SourceType == StockMovementSourceType.Invoice
                         && m.SourceId   == invoice.Id
                         && m.Direction  == StockMovementDirection.Out)
                .ToListAsync();
            if (stale.Count > 0)
            {
                _context.StockMovements.RemoveRange(stale);
            }

            // Skip demo (sandbox) bills — they exist purely to validate
            // FBR scenarios and don't represent real shipments.
            if (invoice.IsDemo)
            {
                await _context.SaveChangesAsync();
                return;
            }

            // 2026-05-12: use the FBR-facing adjusted qty when an overlay
            // exists. Pre-fix this used InvoiceItem.Quantity (the real
            // bill qty), but the operator's stock ledger needs to align
            // with what they're filing — if 116 was reported to FBR for
            // a row, 116 should leave inventory, not the 1 unit on the
            // printed bill. The decomposition was a tax-claim choice;
            // the dashboard reflects that choice consistently.
            //
            // Load adjustments fresh from the DB to avoid relying on EF
            // nav-property fixup — the calling save may have just added
            // the overlay row in the same transaction.
            var overlayQtyByItemId = await _context.InvoiceItemAdjustments
                .Where(a => a.InvoiceId == invoice.Id && a.AdjustedQuantity != null)
                .ToDictionaryAsync(a => a.InvoiceItemId, a => a.AdjustedQuantity!.Value);

            foreach (var item in invoice.Items)
            {
                if (!item.ItemTypeId.HasValue) continue;
                var effectiveQty = overlayQtyByItemId.TryGetValue(item.Id, out var adjQty)
                    ? adjQty
                    : item.Quantity;
                if (effectiveQty <= 0) continue;

                var hasOverlay = overlayQtyByItemId.ContainsKey(item.Id);
                _context.StockMovements.Add(new StockMovement
                {
                    CompanyId    = invoice.CompanyId,
                    ItemTypeId   = item.ItemTypeId.Value,
                    Direction    = StockMovementDirection.Out,
                    // 2026-05-12: stored at full decimal(18,4) precision.
                    // Previously truncated to int (lost fractional KG /
                    // Liter / Carat sales).
                    Quantity     = effectiveQty,
                    SourceType   = StockMovementSourceType.Invoice,
                    SourceId     = invoice.Id,
                    MovementDate = invoice.Date,
                    Notes        = hasOverlay
                        ? $"Bill #{invoice.InvoiceNumber} saved (FBR-adjusted qty {effectiveQty:0.####}, bill row qty {item.Quantity:0.####})"
                        : $"Bill #{invoice.InvoiceNumber} saved",
                    CreatedAt    = DateTime.UtcNow,
                });
            }

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex)
            {
                _logger.LogError(ex,
                    "SyncInvoiceStockMovements failed for invoice={InvoiceId} company={CompanyId}",
                    invoice.Id, invoice.CompanyId);
                throw;
            }
        }

        public async Task<List<StockShortage>> CheckAvailabilityAsync(
            int companyId,
            IEnumerable<StockRequirement> required)
        {
            // When tracking is off, the operator hasn't opted in to the guard.
            // No blocking — they can still post bills to FBR exactly as before.
            if (!await IsTrackingEnabledAsync(companyId))
                return new List<StockShortage>();

            // Sum requirements per ItemTypeId — the same item type can appear
            // on multiple lines, and we need the TOTAL demand to compare
            // against on-hand. Without this aggregation, a 30-then-30
            // split would each pass individually but jointly oversell.
            var demand = required
                .Where(r => r.ItemTypeId > 0 && r.Quantity > 0)
                .GroupBy(r => r.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Quantity = g.Sum(x => x.Quantity),
                    ItemName = g.First().ItemName ?? "",
                })
                .ToList();
            if (demand.Count == 0) return new List<StockShortage>();

            var onHand = await GetOnHandBulkAsync(companyId, demand.Select(d => d.ItemTypeId));

            var shortages = new List<StockShortage>();
            foreach (var d in demand)
            {
                var have = onHand.TryGetValue(d.ItemTypeId, out var q) ? q : 0m;
                if (have < d.Quantity)
                {
                    shortages.Add(new StockShortage(
                        ItemTypeId: d.ItemTypeId,
                        ItemName: d.ItemName,
                        RequiredQuantity: d.Quantity,
                        OnHandQuantity: have,
                        ShortBy: d.Quantity - have));
                }
            }
            return shortages;
        }
    }
}
