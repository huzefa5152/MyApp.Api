using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class StockService : IStockService
    {
        private readonly AppDbContext _context;

        public StockService(AppDbContext context)
        {
            _context = context;
        }

        public async Task<bool> IsTrackingEnabledAsync(int companyId)
        {
            return await _context.Companies
                .Where(c => c.Id == companyId)
                .Select(c => c.InventoryTrackingEnabled)
                .FirstOrDefaultAsync();
        }

        public async Task RecordMovementAsync(
            int companyId,
            int itemTypeId,
            StockMovementDirection direction,
            int quantity,
            StockMovementSourceType sourceType,
            int? sourceId,
            DateTime movementDate,
            string? notes = null)
        {
            if (quantity <= 0) return;
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
            await _context.SaveChangesAsync();
        }

        public async Task<int> GetOnHandAsync(int companyId, int itemTypeId, DateTime? asOfDate = null)
        {
            var dict = await GetOnHandBulkAsync(companyId, new[] { itemTypeId }, asOfDate);
            return dict.TryGetValue(itemTypeId, out var qty) ? qty : 0;
        }

        public async Task<Dictionary<int, int>> GetOnHandBulkAsync(
            int companyId,
            IEnumerable<int> itemTypeIds,
            DateTime? asOfDate = null)
        {
            var ids = itemTypeIds?.Distinct().ToList() ?? new List<int>();
            if (ids.Count == 0) return new Dictionary<int, int>();

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

            var result = new Dictionary<int, int>();
            foreach (var id in ids)
            {
                int onHand = openings.TryGetValue(id, out var op) ? op : 0;
                foreach (var m in moves.Where(x => x.ItemTypeId == id))
                {
                    onHand += m.Direction == StockMovementDirection.In ? m.Qty : -m.Qty;
                }
                result[id] = onHand;
            }
            return result;
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
                var have = onHand.TryGetValue(d.ItemTypeId, out var q) ? q : 0;
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
