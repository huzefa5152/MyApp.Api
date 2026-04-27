using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Inventory dashboard, movement audit feed, opening-balance setup, and
    /// manual adjustments. All endpoints scoped per company.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class StockController : ControllerBase
    {
        private readonly AppDbContext _context;
        private readonly IStockService _stock;

        public StockController(AppDbContext context, IStockService stock)
        {
            _context = context;
            _stock = stock;
        }

        /// <summary>
        /// On-hand grid for the dashboard. Returns one row per ItemType the
        /// company has any data for (movements OR opening balance), sorted
        /// by item name.
        /// </summary>
        [HttpGet("company/{companyId}/onhand")]
        [HasPermission("stock.dashboard.view")]
        public async Task<ActionResult<List<StockOnHandRowDto>>> GetOnHand(int companyId)
        {
            // Items that have ever moved or have an opening balance.
            var movItemIds = await _context.StockMovements
                .Where(m => m.CompanyId == companyId)
                .Select(m => m.ItemTypeId)
                .Distinct()
                .ToListAsync();
            var openItemIds = await _context.OpeningStockBalances
                .Where(o => o.CompanyId == companyId)
                .Select(o => o.ItemTypeId)
                .Distinct()
                .ToListAsync();
            var ids = movItemIds.Union(openItemIds).Distinct().ToList();
            if (ids.Count == 0) return Ok(new List<StockOnHandRowDto>());

            var itemTypes = await _context.ItemTypes
                .Where(it => ids.Contains(it.Id))
                .ToDictionaryAsync(it => it.Id);

            var openings = await _context.OpeningStockBalances
                .Where(o => o.CompanyId == companyId && ids.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Qty);

            var moveAggs = await _context.StockMovements
                .Where(m => m.CompanyId == companyId && ids.Contains(m.ItemTypeId))
                .GroupBy(m => new { m.ItemTypeId, m.Direction })
                .Select(g => new { g.Key.ItemTypeId, g.Key.Direction, Qty = g.Sum(m => m.Quantity) })
                .ToListAsync();

            var lastDates = await _context.StockMovements
                .Where(m => m.CompanyId == companyId && ids.Contains(m.ItemTypeId))
                .GroupBy(m => m.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Last = g.Max(m => m.MovementDate) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Last);

            var rows = new List<StockOnHandRowDto>();
            foreach (var id in ids)
            {
                var it = itemTypes.GetValueOrDefault(id);
                if (it == null) continue;
                int opening = openings.GetValueOrDefault(id);
                int totalIn = moveAggs.Where(x => x.ItemTypeId == id && x.Direction == StockMovementDirection.In).Sum(x => x.Qty);
                int totalOut = moveAggs.Where(x => x.ItemTypeId == id && x.Direction == StockMovementDirection.Out).Sum(x => x.Qty);
                rows.Add(new StockOnHandRowDto
                {
                    ItemTypeId = id,
                    ItemTypeName = it.Name,
                    HSCode = it.HSCode,
                    UOM = it.UOM,
                    OpeningBalance = opening,
                    TotalIn = totalIn,
                    TotalOut = totalOut,
                    OnHand = opening + totalIn - totalOut,
                    LastMovementAt = lastDates.TryGetValue(id, out var d) ? d : null,
                });
            }
            return Ok(rows.OrderBy(r => r.ItemTypeName).ToList());
        }

        /// <summary>Audit feed of every movement, newest first.</summary>
        [HttpGet("company/{companyId}/movements")]
        [HasPermission("stock.movements.view")]
        public async Task<ActionResult<PagedResult<StockMovementRowDto>>> GetMovements(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 25,
            [FromQuery] int? itemTypeId = null,
            [FromQuery] string? sourceType = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var q = _context.StockMovements
                .Include(m => m.ItemType)
                .Where(m => m.CompanyId == companyId);
            if (itemTypeId.HasValue) q = q.Where(m => m.ItemTypeId == itemTypeId.Value);
            if (!string.IsNullOrWhiteSpace(sourceType)
                && Enum.TryParse<StockMovementSourceType>(sourceType, true, out var src))
            {
                q = q.Where(m => m.SourceType == src);
            }
            if (dateFrom.HasValue) q = q.Where(m => m.MovementDate >= dateFrom.Value);
            if (dateTo.HasValue) q = q.Where(m => m.MovementDate <= dateTo.Value);

            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(m => m.MovementDate)
                .ThenByDescending(m => m.Id)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(m => new StockMovementRowDto
                {
                    Id = m.Id,
                    ItemTypeId = m.ItemTypeId,
                    ItemTypeName = m.ItemType.Name,
                    Direction = m.Direction.ToString(),
                    Quantity = m.Quantity,
                    SourceType = m.SourceType.ToString(),
                    SourceId = m.SourceId,
                    MovementDate = m.MovementDate,
                    Notes = m.Notes,
                })
                .ToListAsync();
            return Ok(new PagedResult<StockMovementRowDto>
            {
                Items = rows,
                TotalCount = total,
                Page = page,
                PageSize = pageSize,
            });
        }

        /// <summary>List opening balances for a company.</summary>
        [HttpGet("company/{companyId}/opening")]
        [HasPermission("stock.opening.manage")]
        public async Task<ActionResult<List<OpeningStockBalanceDto>>> GetOpeningBalances(int companyId)
        {
            var rows = await _context.OpeningStockBalances
                .Include(o => o.ItemType)
                .Where(o => o.CompanyId == companyId)
                .OrderBy(o => o.ItemType!.Name)
                .Select(o => new OpeningStockBalanceDto
                {
                    Id = o.Id,
                    CompanyId = o.CompanyId,
                    ItemTypeId = o.ItemTypeId,
                    ItemTypeName = o.ItemType!.Name,
                    Quantity = o.Quantity,
                    AsOfDate = o.AsOfDate,
                    Notes = o.Notes,
                })
                .ToListAsync();
            return Ok(rows);
        }

        /// <summary>
        /// Upsert an opening balance row. There is at most one row per
        /// (Company, ItemType) — see the unique index. Posting the same
        /// pair twice updates the existing row instead of creating a new
        /// one. The movement log uses these via its own
        /// OpeningBalance source-type when computing on-hand.
        /// </summary>
        [HttpPost("opening")]
        [HasPermission("stock.opening.manage")]
        public async Task<ActionResult<OpeningStockBalanceDto>> UpsertOpeningBalance(
            [FromBody] UpsertOpeningBalanceDto dto)
        {
            var existing = await _context.OpeningStockBalances
                .FirstOrDefaultAsync(o => o.CompanyId == dto.CompanyId && o.ItemTypeId == dto.ItemTypeId);
            if (existing == null)
            {
                existing = new OpeningStockBalance
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    Quantity = dto.Quantity,
                    AsOfDate = dto.AsOfDate.Date,
                    Notes = dto.Notes,
                    CreatedAt = DateTime.UtcNow,
                };
                _context.OpeningStockBalances.Add(existing);
            }
            else
            {
                existing.Quantity = dto.Quantity;
                existing.AsOfDate = dto.AsOfDate.Date;
                existing.Notes = dto.Notes;
            }
            await _context.SaveChangesAsync();

            var it = await _context.ItemTypes.FindAsync(existing.ItemTypeId);
            return Ok(new OpeningStockBalanceDto
            {
                Id = existing.Id,
                CompanyId = existing.CompanyId,
                ItemTypeId = existing.ItemTypeId,
                ItemTypeName = it?.Name ?? "",
                Quantity = existing.Quantity,
                AsOfDate = existing.AsOfDate,
                Notes = existing.Notes,
            });
        }

        [HttpDelete("opening/{id}")]
        [HasPermission("stock.opening.manage")]
        public async Task<IActionResult> DeleteOpeningBalance(int id)
        {
            var row = await _context.OpeningStockBalances.FindAsync(id);
            if (row == null) return NotFound();
            _context.OpeningStockBalances.Remove(row);
            await _context.SaveChangesAsync();
            return NoContent();
        }

        /// <summary>
        /// Manual stock adjustment — count corrections, write-offs, or
        /// breakage. Always emits a single signed movement; positive Delta =
        /// In, negative = Out. Works even when InventoryTrackingEnabled is
        /// false on the company so back-fill before flipping the flag is
        /// possible too.
        /// </summary>
        [HttpPost("adjust")]
        [HasPermission("stock.adjust.create")]
        public async Task<IActionResult> AdjustStock([FromBody] CreateStockAdjustmentDto dto)
        {
            if (dto.Delta == 0) return BadRequest(new { error = "Delta cannot be zero." });

            // Bypass the IsTrackingEnabled gate by writing directly: an
            // explicit adjustment is the operator's deliberate act, and we
            // want it to land on the ledger so it shows up as soon as
            // tracking is turned on.
            _context.StockMovements.Add(new StockMovement
            {
                CompanyId = dto.CompanyId,
                ItemTypeId = dto.ItemTypeId,
                Direction = dto.Delta > 0 ? StockMovementDirection.In : StockMovementDirection.Out,
                Quantity = Math.Abs(dto.Delta),
                SourceType = StockMovementSourceType.Adjustment,
                SourceId = null,
                MovementDate = dto.MovementDate.Date,
                Notes = dto.Notes,
                CreatedAt = DateTime.UtcNow,
            });
            await _context.SaveChangesAsync();
            return Ok(new { message = "Adjustment recorded." });
        }
    }
}
