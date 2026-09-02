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
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Qty = g.Sum(o => o.Quantity),
                    Value = g.Sum(o => o.ValueExcludingTax),
                    Rate = g.Max(o => o.SalesTaxRate),
                })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x);

            // Valuation needs the movements THEMSELVES, in order, not a sum per
            // direction: an outward movement is costed at the weighted average
            // standing at that moment, which only exists if you walk them.
            var movements = await ScopedMovements()
                .Where(m => ids.Contains(m.ItemTypeId))
                .AsNoTracking()
                .ToListAsync();
            var movementsByItem = movements
                .GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());

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
                var open = openings.GetValueOrDefault(id);
                decimal opening = open?.Qty ?? 0m;

                var position = StockValuation.Compute(
                    opening,
                    open?.Value ?? 0m,
                    open?.Rate ?? 0m,
                    movementsByItem.GetValueOrDefault(id) ?? new List<StockMovement>());

                rows.Add(new StockOnHandRowDto
                {
                    ItemTypeId = id,
                    ItemTypeName = it.Name,
                    HSCode = it.HSCode,
                    UOM = it.UOM,
                    OpeningBalance = opening,
                    TotalIn = position.TotalIn,
                    TotalOut = position.TotalOut,
                    OnHand = position.Quantity,
                    ValueExcludingTax = position.ValueExcludingTax,
                    SalesTaxRate = position.SalesTaxRate,
                    SalesTax = position.SalesTax,
                    ValueIncludingTax = position.ValueIncludingTax,
                    UnitCost = Math.Round(position.UnitCost, 4),
                    ValueIn = position.ValueIn,
                    ValueOut = position.ValueOut,
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

            // Money per movement. The cost of any one movement is the average
            // standing at that instant, so the only way to fill these in is to
            // replay each item's full history — the page's rows alone can't say
            // what a sale cost. Bounded by the page's distinct items.
            var pageItemIds = rows.Select(r => r.ItemTypeId).Distinct().ToList();
            if (pageItemIds.Count > 0)
            {
                var histOpenings = await _context.OpeningStockBalances
                    .Where(o => o.CompanyId == companyId && pageItemIds.Contains(o.ItemTypeId))
                    .GroupBy(o => o.ItemTypeId)
                    .Select(g => new
                    {
                        ItemTypeId = g.Key,
                        Qty = g.Sum(o => o.Quantity),
                        Value = g.Sum(o => o.ValueExcludingTax),
                        Rate = g.Max(o => o.SalesTaxRate),
                    })
                    .ToDictionaryAsync(x => x.ItemTypeId, x => x);

                // Same division scope as the listing itself, or the running
                // totals would be computed over rows the caller cannot see.
                var histQuery = _context.StockMovements
                    .Where(m => m.CompanyId == companyId && pageItemIds.Contains(m.ItemTypeId));
                if (divScope != null)
                    histQuery = histQuery.Where(m => m.DivisionId == null || divScope.Contains(m.DivisionId.Value));
                var history = await histQuery.AsNoTracking().ToListAsync();

                var steps = new Dictionary<int, StockValuation.Step>();
                foreach (var grp in history.GroupBy(m => m.ItemTypeId))
                {
                    var open = histOpenings.GetValueOrDefault(grp.Key);
                    var trace = new List<StockValuation.Step>();
                    StockValuation.Compute(open?.Qty ?? 0m, open?.Value ?? 0m, open?.Rate ?? 0m,
                                           grp.ToList(), trace);
                    foreach (var st in trace) steps[st.MovementId] = st;
                }

                foreach (var r in rows)
                {
                    if (!steps.TryGetValue(r.Id, out var st)) continue;
                    r.UnitCost = Math.Round(st.UnitCost, 4, MidpointRounding.AwayFromZero);
                    r.Value = st.Amount;
                    r.RunningQuantity = st.RunningQuantity;
                    r.RunningValue = st.RunningValue;
                }
            }

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
                    ValueExcludingTax = o.ValueExcludingTax,
                    SalesTaxRate = o.SalesTaxRate,
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
                    ValueExcludingTax = dto.ValueExcludingTax,
                    SalesTaxRate = dto.SalesTaxRate,
                    AsOfDate = dto.AsOfDate.Date,
                    Notes = dto.Notes,
                    CreatedAt = DateTime.UtcNow,
                };
                _context.OpeningStockBalances.Add(existing);
            }
            else
            {
                existing.Quantity = dto.Quantity;
                existing.ValueExcludingTax = dto.ValueExcludingTax;
                existing.SalesTaxRate = dto.SalesTaxRate;
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
                ValueExcludingTax = existing.ValueExcludingTax,
                SalesTaxRate = existing.SalesTaxRate,
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
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Adjustments correct company-level inventory — blocked for
            // division-restricted users (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, null);

            var mode = string.Equals(dto.Mode, StockAdjustmentModes.Set, StringComparison.OrdinalIgnoreCase)
                ? StockAdjustmentModes.Set
                : StockAdjustmentModes.Delta;

            // Where the item stands right now, valued the one way stock is ever
            // valued. Needed by BOTH modes: "set" subtracts from it to find the
            // change, and "delta" checks the result against it.
            var current = await CurrentPositionAsync(dto.CompanyId, dto.ItemTypeId);

            decimal qtyDelta;
            decimal valueDelta;
            decimal? unitCost = null;
            decimal? rate = null;

            if (mode == StockAdjustmentModes.Set)
            {
                if (dto.TargetQuantity is null && dto.TargetValueExcludingTax is null)
                    return BadRequest(new { error = "Say what the quantity or the value should be." });

                var targetQty = dto.TargetQuantity ?? current.Quantity;
                var targetValue = dto.TargetValueExcludingTax ?? current.ValueExcludingTax;

                if (targetQty < 0) return BadRequest(new { error = "On-hand cannot be negative." });
                if (targetValue < 0) return BadRequest(new { error = "Stock value cannot be negative." });

                // Stock that has run out is worth exactly nothing, so a target
                // pairing zero quantity with money left over is refused rather
                // than silently discarded (CLAUDE.md 5b-4).
                if (targetQty == 0 && targetValue > 0)
                    return BadRequest(new
                    {
                        error = "An on-hand of zero must be worth zero. Set the value to 0 as well, "
                              + "or give the quantity that is actually there."
                    });

                qtyDelta = Round4(targetQty - current.Quantity);

                // A quantity movement changes the VALUE too, so the money the
                // revaluation still has to make up is measured against where
                // the quantity movement will leave things — not against where
                // they stand now. Getting this wrong took the value down twice
                // when a correction lowered both figures at once.
                var average = current.Quantity > 0m
                    ? current.ValueExcludingTax / current.Quantity
                    : 0m;
                decimal predictedValue;

                if (qtyDelta > 0m && targetValue > current.ValueExcludingTax)
                {
                    // Adding stock AND value: the operator's own two figures say
                    // what the addition cost, so carry it on the movement and the
                    // average lands exactly where they said it should.
                    unitCost = (targetValue - current.ValueExcludingTax) / qtyDelta;
                    predictedValue = targetValue;
                }
                else if (qtyDelta > 0m)
                {
                    // Adding stock while the value stays put or falls: the
                    // movement states no cost, so the walk values it at the
                    // running average and the revaluation corrects the rest.
                    predictedValue = current.ValueExcludingTax + (qtyDelta * average);
                }
                else if (qtyDelta < 0m)
                {
                    // Stock leaving is costed at the average, and an emptied bin
                    // is worth exactly zero — the same rule the walk applies.
                    predictedValue = targetQty <= 0m
                        ? 0m
                        : current.ValueExcludingTax - (-qtyDelta * average);
                }
                else
                {
                    predictedValue = current.ValueExcludingTax;
                }

                valueDelta = Money(targetValue - Money(predictedValue));

                if (qtyDelta == 0m && valueDelta == 0m
                    && !(dto.SalesTaxRate is >= 0m and <= 100m && dto.SalesTaxRate != current.SalesTaxRate))
                    return BadRequest(new { error = "Those are already the figures on record — nothing to correct." });
            }
            else
            {
                qtyDelta = dto.Delta;
                valueDelta = Money(dto.ValueDelta ?? 0m);

                if (qtyDelta == 0m && valueDelta == 0m)
                    return BadRequest(new { error = "Give a quantity change, a value change, or both." });

                if (qtyDelta > 0m && dto.UnitCostExcludingTax is > 0m)
                    unitCost = dto.UnitCostExcludingTax.Value;
            }

            var tracking = await _stock.IsTrackingEnabledAsync(dto.CompanyId);

            // A negative quantity change cannot drive on-hand below zero. A
            // tracking-disabled company still bypasses this: its dashboard is
            // allowed to be half-set until the flag goes on.
            if (qtyDelta < 0m && tracking && current.Quantity + qtyDelta < 0m)
            {
                return BadRequest(new
                {
                    error = $"Adjustment would drive on-hand to {current.Quantity + qtyDelta} "
                          + $"(current {current.Quantity}). Increase the on-hand first, or reduce the decrease."
                });
            }

            // Nor may a value change drive the stock value below zero.
            if (valueDelta < 0m && current.ValueExcludingTax + valueDelta < -0.005m)
            {
                return BadRequest(new
                {
                    error = $"That would take the stock value below zero (currently "
                          + $"{current.ValueExcludingTax:N2}). Reduce the decrease."
                });
            }

            if (dto.SalesTaxRate is >= 0m and <= 100m)
                rate = Math.Round(dto.SalesTaxRate.Value, 2, MidpointRounding.AwayFromZero);

            var written = new List<string>();

            // Bypass the IsTrackingEnabled gate by writing directly: an explicit
            // adjustment is the operator's deliberate act, and it should land on
            // the ledger so it shows up as soon as tracking is turned on.
            if (qtyDelta != 0m)
            {
                _context.StockMovements.Add(new StockMovement
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    Direction = qtyDelta > 0m ? StockMovementDirection.In : StockMovementDirection.Out,
                    Quantity = Math.Abs(qtyDelta),
                    SourceType = StockMovementSourceType.Adjustment,
                    SourceId = null,
                    MovementDate = dto.MovementDate.Date,
                    Notes = dto.Notes,
                    // Only an increase can state a cost. Stock leaving is always
                    // costed at the running average — see StockValuation.
                    UnitCostExcludingTax = qtyDelta > 0m && unitCost is > 0m
                        ? Math.Round(unitCost.Value, 4, MidpointRounding.AwayFromZero)
                        : null,
                    SalesTaxRate = qtyDelta > 0m && unitCost is > 0m ? rate : null,
                    CreatedAt = DateTime.UtcNow,
                });
                written.Add(qtyDelta > 0m
                    ? $"quantity up {Math.Abs(qtyDelta):0.####}"
                    : $"quantity down {Math.Abs(qtyDelta):0.####}");
            }

            // A value-only correction: no goods moved, so it is a revaluation
            // row with zero quantity carrying the signed money.
            if (valueDelta != 0m || (qtyDelta == 0m && rate.HasValue && rate != current.SalesTaxRate))
            {
                _context.StockMovements.Add(new StockMovement
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    // The enum has no "neither" and the row carries no quantity,
                    // so the direction simply records which way the money went.
                    Direction = valueDelta >= 0m ? StockMovementDirection.In : StockMovementDirection.Out,
                    Quantity = 0m,
                    SourceType = StockMovementSourceType.Revaluation,
                    SourceId = null,
                    MovementDate = dto.MovementDate.Date,
                    Notes = dto.Notes,
                    ValueAdjustmentExcludingTax = valueDelta,
                    SalesTaxRate = rate,
                    CreatedAt = DateTime.UtcNow,
                });
                if (valueDelta != 0m)
                    written.Add($"value {(valueDelta > 0m ? "up" : "down")} {Math.Abs(valueDelta):N2}");
                else
                    written.Add($"rate set to {rate:0.##}%");
            }

            if (written.Count == 0)
                return BadRequest(new { error = "Nothing to record." });

            await _context.SaveChangesAsync();

            var after = await CurrentPositionAsync(dto.CompanyId, dto.ItemTypeId);
            return Ok(new
            {
                message = "Adjustment recorded: " + string.Join(", ", written) + ".",
                quantity = after.Quantity,
                valueExcludingTax = after.ValueExcludingTax,
                salesTaxRate = after.SalesTaxRate,
                salesTax = after.SalesTax,
                valueIncludingTax = after.ValueIncludingTax,
            });
        }

        /// <summary>
        /// Where one item stands right now — quantity and money — through the
        /// same weighted-average walk the dashboard uses, so an adjustment is
        /// measured against exactly what the operator can see.
        /// </summary>
        private async Task<StockValuation.Position> CurrentPositionAsync(int companyId, int itemTypeId)
        {
            // Delegates: the valuation walk lives in the stock service so the
            // dashboard, an adjustment and the bill form all read one figure.
            var byItem = await _stock.GetValuationsAsync(companyId, new[] { itemTypeId });
            return byItem.TryGetValue(itemTypeId, out var p) ? p : default;
        }

        private static decimal Money(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);
        private static decimal Round4(decimal v) => Math.Round(v, 4, MidpointRounding.AwayFromZero);

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
