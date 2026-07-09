using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
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
        private readonly IInventoryReadService _inventory;
        private readonly IAuditLogService _audit;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _defaultPageSize;

        public StockController(AppDbContext context, IStockService stock, IInventoryReadService inventory,
            IAuditLogService audit, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IConfiguration configuration)
        {
            _context = context;
            _stock = stock;
            _inventory = inventory;
            _audit = audit;
            _access = access;
            _divisionAccess = divisionAccess;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// On-hand grid for the dashboard. Returns one row per ItemType the
        /// company has any data for (movements OR opening balance), sorted
        /// by item name.
        /// </summary>
        [HttpGet("company/{companyId}/onhand")]
        [HasPermission("stock.dashboard.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<StockOnHandRowDto>>> GetOnHand(int companyId)
        {
            // Division RBAC: restricted users see company-level movements plus
            // their divisions' (policy D1); other divisions' traffic is
            // excluded from every aggregate below. Openings stay unfiltered —
            // they're company-level by design.
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            IQueryable<StockMovement> ScopedMovements() =>
                divScope == null
                    ? _context.StockMovements.Where(m => m.CompanyId == companyId)
                    : _context.StockMovements.Where(m => m.CompanyId == companyId
                        && (m.DivisionId == null || divScope.Contains(m.DivisionId.Value)));

            // Items that have ever moved or have an opening balance.
            var movItemIds = await ScopedMovements()
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

            // Exclude soft-deleted item types: a deleted catalog row keeps its
            // StockMovements (delete doesn't block on movements — see
            // ItemTypeService.DeleteAsync), so without this filter a deleted
            // item still surfaced on the on-hand grid. Missing ids fall through
            // to `it == null → continue` below and drop out of the dashboard.
            var itemTypes = await _context.ItemTypes
                .Where(it => ids.Contains(it.Id) && !it.IsDeleted)
                .ToDictionaryAsync(it => it.Id);

            var openings = await _context.OpeningStockBalances
                .Where(o => o.CompanyId == companyId && ids.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Qty);

            var moveAggs = await ScopedMovements()
                .Where(m => ids.Contains(m.ItemTypeId))
                .GroupBy(m => new { m.ItemTypeId, m.Direction })
                .Select(g => new { g.Key.ItemTypeId, g.Key.Direction, Qty = g.Sum(m => m.Quantity) })
                .ToListAsync();

            var lastDates = await ScopedMovements()
                .Where(m => ids.Contains(m.ItemTypeId))
                .GroupBy(m => m.ItemTypeId)
                .Select(g => new { ItemTypeId = g.Key, Last = g.Max(m => m.MovementDate) })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x.Last);

            var rows = new List<StockOnHandRowDto>();
            foreach (var id in ids)
            {
                var it = itemTypes.GetValueOrDefault(id);
                if (it == null) continue;
                // 2026-05-12: decimal opening + totalIn/Out matches the
                // promoted StockMovement / OpeningStockBalance columns.
                decimal opening = openings.GetValueOrDefault(id);
                decimal totalIn = moveAggs.Where(x => x.ItemTypeId == id && x.Direction == StockMovementDirection.In).Sum(x => x.Qty);
                decimal totalOut = moveAggs.Where(x => x.ItemTypeId == id && x.Direction == StockMovementDirection.Out).Sum(x => x.Qty);
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
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<StockMovementRowDto>>> GetMovements(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] int? itemTypeId = null,
            [FromQuery] string? sourceType = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            // Resolve page size: caller can override via ?pageSize=NN, otherwise
            // fall back to Pagination:DefaultPageSize from appsettings — same
            // convention DeliveryChallans + InvoicesController follow so the
            // operator's tuned default value flows through here too.
            // Audit C-11 (2026-05-13): clamp to a sane upper bound.
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);

            var q = _context.StockMovements
                .Include(m => m.ItemType)
                .Where(m => m.CompanyId == companyId);
            // Division RBAC: restricted users only see company-level movements
            // plus their own divisions' (policy D1).
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            if (divScope != null)
                q = q.Where(m => m.DivisionId == null || divScope.Contains(m.DivisionId.Value));
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
                .Skip((clampedPage - 1) * size)
                .Take(size)
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

            // Resolve human-facing document numbers for the source rows.
            // SourceId is the internal PK (e.g. Invoice.Id) — operators need
            // the InvoiceNumber / PurchaseBillNumber / GoodsReceiptNumber.
            // Batched per source type so the page is at most 3 extra queries.
            var invoiceIds = rows.Where(r => r.SourceType == nameof(StockMovementSourceType.Invoice) && r.SourceId.HasValue)
                                 .Select(r => r.SourceId!.Value).Distinct().ToList();
            var billIds = rows.Where(r => r.SourceType == nameof(StockMovementSourceType.PurchaseBill) && r.SourceId.HasValue)
                              .Select(r => r.SourceId!.Value).Distinct().ToList();
            var grIds = rows.Where(r => r.SourceType == nameof(StockMovementSourceType.GoodsReceipt) && r.SourceId.HasValue)
                            .Select(r => r.SourceId!.Value).Distinct().ToList();

            var invNums = invoiceIds.Count == 0 ? new Dictionary<int, int>()
                : await _context.Invoices.Where(i => invoiceIds.Contains(i.Id))
                    .Select(i => new { i.Id, i.InvoiceNumber })
                    .ToDictionaryAsync(x => x.Id, x => x.InvoiceNumber);
            var billNums = billIds.Count == 0 ? new Dictionary<int, int>()
                : await _context.PurchaseBills.Where(p => billIds.Contains(p.Id))
                    .Select(p => new { p.Id, p.PurchaseBillNumber })
                    .ToDictionaryAsync(x => x.Id, x => x.PurchaseBillNumber);
            var grNums = grIds.Count == 0 ? new Dictionary<int, int>()
                : await _context.GoodsReceipts.Where(g => grIds.Contains(g.Id))
                    .Select(g => new { g.Id, g.GoodsReceiptNumber })
                    .ToDictionaryAsync(x => x.Id, x => x.GoodsReceiptNumber);

            foreach (var r in rows)
            {
                if (!r.SourceId.HasValue) continue;
                if (r.SourceType == nameof(StockMovementSourceType.Invoice) && invNums.TryGetValue(r.SourceId.Value, out var iNo))
                    r.SourceDocNumber = iNo.ToString();
                else if (r.SourceType == nameof(StockMovementSourceType.PurchaseBill) && billNums.TryGetValue(r.SourceId.Value, out var pNo))
                    r.SourceDocNumber = pNo.ToString();
                else if (r.SourceType == nameof(StockMovementSourceType.GoodsReceipt) && grNums.TryGetValue(r.SourceId.Value, out var gNo))
                    r.SourceDocNumber = gNo.ToString();
            }

            return Ok(new PagedResult<StockMovementRowDto>
            {
                Items = rows,
                TotalCount = total,
                Page = clampedPage,
                PageSize = size,
            });
        }

        /// <summary>List opening balances for a company.</summary>
        [HttpGet("company/{companyId}/opening")]
        [HasPermission("stock.opening.manage")]
        [AuthorizeCompany]
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
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Opening balances are company-level inventory state — a
            // division-restricted user may not write that scope (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, null);
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
            await _access.AssertAccessAsync(CurrentUserId, row.CompanyId);
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, row.CompanyId, null);
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
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Adjustments correct company-level inventory — blocked for
            // division-restricted users (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, null);

            // Negative deltas can't drive stock below zero. The previous
            // version of this endpoint allowed any signed delta — useful
            // when seeding ledgers but a footgun once tracking is on.
            // Tracking-disabled companies still bypass the check (their
            // dashboard can be in a half-set state until they turn it on).
            if (dto.Delta < 0 && await _stock.IsTrackingEnabledAsync(dto.CompanyId))
            {
                var onHand = await _stock.GetOnHandAsync(dto.CompanyId, dto.ItemTypeId);
                if (onHand + dto.Delta < 0)
                {
                    return BadRequest(new
                    {
                        error = $"Adjustment would drive on-hand to {onHand + dto.Delta} (current {onHand}). " +
                                "Increase the on-hand first or reduce the negative delta."
                    });
                }
            }

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

        /// <summary>
        /// Inventory summary (V2 derived read model): one row per item type with
        /// OnHand / Committed / ToDeliver / Delivered / Available / Incoming,
        /// computed live from documents. Backs the central inventory summary on
        /// the Item Types screen and the stock dashboard buckets.
        /// </summary>
        [HttpGet("company/{companyId}/summary")]
        [HasPermission("stock.dashboard.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<InventoryBucketRow>>> GetInventorySummary(int companyId)
        {
            // Division RBAC scope (policy D1) — same shape the on-hand grid uses.
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            var rows = await _inventory.GetBucketsAsync(companyId, null, divScope);
            return Ok(rows);
        }

        /// <summary>
        /// Switch a company between inventory tracking versions:
        /// 1 = V1 legacy (only HS-coded item types tracked) and 2 = V2
        /// (all item types are inventory; HS code is FBR metadata only).
        /// Reversible and audited — safe because the derived read model
        /// persists no bucket snapshots, so a flip requires no data migration
        /// or cleanup (Q8). Gated by stock.policy.manage (admin).
        /// </summary>
        [HttpPost("company/{companyId}/flow-version")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetFlowVersion(int companyId, [FromBody] SetInventoryFlowVersionRequest req)
        {
            if (req == null || (req.Version != 1 && req.Version != 2))
                return BadRequest(new { error = "Version must be 1 (legacy HS-gated) or 2 (standard inventory)." });

            var company = await _context.Companies.FirstOrDefaultAsync(c => c.Id == companyId);
            if (company == null) return NotFound();

            var previous = company.InventoryFlowVersion;
            if (previous == req.Version)
                return Ok(new { companyId, inventoryFlowVersion = previous, changed = false });

            company.InventoryFlowVersion = req.Version;
            // Q4: over-commit/oversell is hard-blocked by default under V2.
            // Turning V2 on enables the guard; operators can still switch it to
            // soft mode afterwards via the company update. Leaving V2 keeps the
            // operator's current setting (no forced change on the way back).
            if (req.Version == (byte)InventoryFlowVersion.V2Standard && !company.StockGuardHardBlock)
                company.StockGuardHardBlock = true;
            await _context.SaveChangesAsync();

            await _audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = User.Identity?.Name,
                HttpMethod = "POST",
                RequestPath = $"/api/stock/company/{companyId}/flow-version",
                StatusCode = 200,
                ExceptionType = "INVENTORY_POLICY_CHANGE",
                Message = $"Inventory flow version changed {previous} → {req.Version} for company {companyId}",
                CompanyId = companyId,
            });

            return Ok(new { companyId, inventoryFlowVersion = req.Version, changed = true, previous });
        }

        /// <summary>
        /// Set (upsert) a per-company inventory policy override for one item
        /// type: Mode (0 = follow the company default, 1 = force-tracked,
        /// 2 = FBR-only / excluded from inventory) and an optional reorder
        /// level. Since ItemType is a global catalog, this per-company override
        /// is the only place tracking can be tuned per item. Gated by
        /// stock.policy.manage.
        /// </summary>
        [HttpPost("company/{companyId}/itemtype-policy")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetItemTypePolicy(int companyId, [FromBody] SetItemTypePolicyRequest req)
        {
            if (req == null || req.ItemTypeId <= 0)
                return BadRequest(new { error = "itemTypeId is required." });
            if (req.Mode > 2)
                return BadRequest(new { error = "mode must be 0 (default), 1 (tracked) or 2 (FBR-only)." });
            if (!await _context.ItemTypes.AnyAsync(it => it.Id == req.ItemTypeId))
                return NotFound(new { error = "Item type not found." });

            var setting = await _context.CompanyItemTypeSettings
                .FirstOrDefaultAsync(s => s.CompanyId == companyId && s.ItemTypeId == req.ItemTypeId);
            if (setting == null)
            {
                setting = new CompanyItemTypeSetting
                {
                    CompanyId = companyId,
                    ItemTypeId = req.ItemTypeId,
                    CreatedAt = DateTime.UtcNow,
                };
                _context.CompanyItemTypeSettings.Add(setting);
            }
            setting.Mode = (InventoryItemMode)req.Mode;
            setting.ReorderLevel = req.ReorderLevel;
            setting.UpdatedAt = DateTime.UtcNow;
            await _context.SaveChangesAsync();

            return Ok(new { companyId, itemTypeId = req.ItemTypeId, mode = req.Mode, reorderLevel = req.ReorderLevel });
        }
    }

    /// <summary>Request body for POST company/{id}/flow-version.</summary>
    public record SetInventoryFlowVersionRequest(byte Version);

    /// <summary>Request body for POST company/{id}/itemtype-policy.</summary>
    public record SetItemTypePolicyRequest(int ItemTypeId, byte Mode, decimal? ReorderLevel);
}
