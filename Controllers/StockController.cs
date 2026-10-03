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
        private readonly IPermissionService _permission;
        private readonly IStockCostAuditService _costAudit;
        private readonly IPostingService _posting;
        private readonly ILogger<StockController> _logger;
        private readonly int _defaultPageSize;

        public StockController(AppDbContext context, IStockService stock, IInventoryReadService inventory,
            IAuditLogService audit, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IPermissionService permission,
            IStockCostAuditService costAudit, IPostingService posting,
            ILogger<StockController> logger, IConfiguration configuration)
        {
            _context = context;
            _stock = stock;
            _inventory = inventory;
            _audit = audit;
            _access = access;
            _divisionAccess = divisionAccess;
            _permission = permission;
            _costAudit = costAudit;
            _posting = posting;
            _logger = logger;
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
            var (rows, _) = await BuildOnHandAsync(companyId, withMovements: false);
            await AttachGdNumbersAsync(companyId, rows);
            return Ok(rows);
        }

        /// <summary>Fills each row's GD numbers from the same source rows the
        /// GD drill-down shows, ordered by declaration date.</summary>
        private async Task<List<StockGdDetailDto>> AttachGdNumbersAsync(
            int companyId, List<StockOnHandRowDto> rows)
        {
            var details = await BuildGdDetailsAsync(companyId, rows.Select(r => r.ItemTypeId).ToList());
            var byItem = details.GroupBy(d => d.ItemTypeId).ToDictionary(g => g.Key, g => g
                .OrderBy(d => d.GdDate ?? DateTime.MaxValue).ThenBy(d => d.GdNumber)
                .Select(d => d.GdNumber).Distinct(StringComparer.OrdinalIgnoreCase).ToList());
            foreach (var r in rows)
                r.GdNumbers = byItem.TryGetValue(r.ItemTypeId, out var gds) ? gds : new();
            return details;
        }

        /// <summary>GD source rows behind an item's company-level opening position.
        /// Cost-only backfills carry no added quantity; later sales are never
        /// allocated to a GD without a recorded lot issue.</summary>
        [HttpGet("company/{companyId}/gd-details")]
        [HasPermission("stock.dashboard.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<StockGdDetailDto>>> GetGdDetails(
            int companyId, [FromQuery] int? itemTypeId = null)
        {
            if (itemTypeId is <= 0) return BadRequest(new { error = "Choose a valid item." });
            var rows = await BuildGdDetailsAsync(companyId,
                itemTypeId.HasValue ? new List<int> { itemTypeId.Value } : null);
            // Landed cost is gated like every other actual-cost figure.
            if (!await _permission.HasPermissionAsync(CurrentUserId, "stock.actualcost.view"))
                foreach (var r in rows) r.ActualCostExcludingTax = null;
            return Ok(rows);
        }

        /// <summary>Record the period actually filed for a GD. It is distinct
        /// from the declaration date and may remain unknown.</summary>
        [HttpPut("company/{companyId}/gd-claim-month")]
        [HasPermission("stock.opening.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetGdClaimMonth(int companyId, [FromBody] SetGdClaimMonthDto dto)
        {
            // A claim month changes company-level stock costing (FIFO order), so
            // a division-restricted user may not write it (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, null);
            var number = dto.GdNumber?.Trim() ?? "";
            if (number.Length == 0 || number.Length > 100)
                return BadRequest(new { error = "Enter a valid GD number." });
            if (dto.ClaimMonth is { } month && (month.Day != 1 || month.TimeOfDay != TimeSpan.Zero))
                return BadRequest(new { error = "Claim month must be the first day of the month." });

            var known = await _context.ImportConsignments.AnyAsync(c => c.CompanyId == companyId && c.GdNumber == number)
                || await _context.OpeningStockLots.AnyAsync(l =>
                    l.OpeningStockBalance.CompanyId == companyId && l.LotRef == number);
            if (!known) return NotFound(new { error = "This company has no stock GD with that number." });

            var existing = await _context.GdClaimPeriods
                .FirstOrDefaultAsync(x => x.CompanyId == companyId && x.GdNumber == number);
            if (dto.ClaimMonth == null)
            {
                if (existing != null) _context.GdClaimPeriods.Remove(existing);
            }
            else if (existing == null)
            {
                _context.GdClaimPeriods.Add(new GdClaimPeriod
                {
                    CompanyId = companyId, GdNumber = number, ClaimMonth = dto.ClaimMonth.Value,
                });
            }
            else existing.ClaimMonth = dto.ClaimMonth.Value;

            await _context.SaveChangesAsync();
            await _audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = User.Identity?.Name,
                HttpMethod = "PUT",
                RequestPath = $"/api/stock/company/{companyId}/gd-claim-month",
                StatusCode = 204,
                ExceptionType = "GD_CLAIM_MONTH_CHANGE",
                Message = $"GD {number} claim month {(dto.ClaimMonth.HasValue ? "set" : "cleared")} for company {companyId}",
                CompanyId = companyId,
            });
            return NoContent();
        }

        /// <summary>Record the claimed month of ONE GD line — an opening-sheet
        /// line or a GD-import line. A GD's items are often claimed in
        /// different returns, so this is the figure the sheet itself carries;
        /// it wins over the GD-level month.</summary>
        [HttpPut("company/{companyId}/line-claim-month")]
        [HasPermission("stock.opening.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetLineClaimMonth(int companyId, [FromBody] SetLineClaimMonthDto dto)
        {
            // A claim month changes company-level stock costing (FIFO order), so
            // a division-restricted user may not write it (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, null);
            if (dto.ClaimMonth is { } month && (month.Day != 1 || month.TimeOfDay != TimeSpan.Zero))
                return BadRequest(new { error = "Claim month must be the first day of the month." });
            if ((dto.LotId == null) == (dto.ConsignmentLineId == null))
                return BadRequest(new { error = "Choose one stock line." });

            // Scoped by the line's OWN company, never the route's alone: an id
            // from another tenant must read as unknown, not be written.
            string? gd; int row;
            if (dto.LotId is { } lotId)
            {
                var lot = await _context.OpeningStockLots
                    .FirstOrDefaultAsync(l => l.Id == lotId && l.OpeningStockBalance.CompanyId == companyId);
                if (lot == null) return NotFound(new { error = "This company has no such stock line." });
                lot.ClaimMonth = dto.ClaimMonth;
                gd = lot.LotRef; row = lot.SourceRow;
            }
            else
            {
                var line = await _context.ImportConsignmentLines.Include(l => l.ImportConsignment)
                    .FirstOrDefaultAsync(l => l.Id == dto.ConsignmentLineId && l.ImportConsignment.CompanyId == companyId);
                if (line == null) return NotFound(new { error = "This company has no such stock line." });
                line.ClaimMonth = dto.ClaimMonth;
                gd = line.ImportConsignment.GdNumber; row = line.SourceRow;
            }
            await _context.SaveChangesAsync();
            await _audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = User.Identity?.Name,
                HttpMethod = "PUT",
                RequestPath = $"/api/stock/company/{companyId}/line-claim-month",
                StatusCode = 204,
                ExceptionType = "LINE_CLAIM_MONTH_CHANGE",
                Message = $"GD {gd} row {row} claim month {(dto.ClaimMonth.HasValue ? "set" : "cleared")} for company {companyId}",
                CompanyId = companyId,
            });
            return NoContent();
        }

        /// <summary>
        /// The FIFO-by-GD walk for each item -- its pools and what every
        /// movement took from them -- or null when the company values stock at
        /// the weighted average. Same inputs, division scope and walk as the
        /// on-hand grid, so a GD's consumed figure cannot disagree with it.
        /// </summary>
        private async Task<Dictionary<int, GdFifoValuation.Result>?> FifoResultsAsync(
            int companyId, List<int> itemTypeIds)
            => (await FifoResultsBeforeAsync(companyId, itemTypeIds, null))?.Results;

        /// <summary>
        /// The same walk over only the movements dated before
        /// <paramref name="before"/> (all of them when null) -- the position on
        /// that morning. Returns the movements walked, by id, so a caller can
        /// date each take.
        /// </summary>
        private async Task<(Dictionary<int, GdFifoValuation.Result> Results, Dictionary<int, StockMovement> Movements)?>
            FifoResultsBeforeAsync(int companyId, List<int> itemTypeIds, DateTime? before)
        {
            if (itemTypeIds.Count == 0 || !await StockCostingMethod.IsGdFifoAsync(_context, companyId))
                return null;
            var costing = await StockCosting.LoadAsync(_context, companyId, itemTypeIds);
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            var openings = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId && itemTypeIds.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Qty = g.Sum(o => o.Quantity),
                    Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax),
                    Rate = g.Max(o => o.SalesTaxRate),
                })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x);
            var q = _context.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId && itemTypeIds.Contains(m.ItemTypeId));
            if (divScope != null)
                q = q.Where(m => m.DivisionId == null || divScope.Contains(m.DivisionId.Value));
            if (before.HasValue)
                q = q.Where(m => m.MovementDate < before.Value);
            var all = await q.ToListAsync();
            var byItem = all.GroupBy(m => m.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var result = new Dictionary<int, GdFifoValuation.Result>();
            foreach (var id in itemTypeIds)
            {
                var open = openings.GetValueOrDefault(id);
                result[id] = costing.Detailed(id, open?.Qty ?? 0m, open?.Value ?? 0m,
                    open?.ActualCost ?? 0m, open?.Rate ?? 0m,
                    byItem.GetValueOrDefault(id) ?? new List<StockMovement>());
            }
            return (result, all.ToDictionary(m => m.Id));
        }

        /// <summary>What a pool is called on screen and in the sheet.</summary>
        private static string PoolLabel(GdFifoValuation.Pool? p, string key) => key switch
        {
            GdFifoValuation.ShortfallKey => "Not covered by a GD",
            GdFifoValuation.UntracedKey => "Opening — not traced to a GD",
            _ when p?.GdNumber is { Length: > 0 } gd => $"GD {gd}",
            _ => "Other stock in",
        };

        /// <summary>
        /// FIFO by GD: one export row per GD (lots of one GD summed), plus the
        /// opening stock no GD explains, other stock in, and any sale not yet
        /// covered by stock -- each with what came in, what sales took, and
        /// what is left, in the order a sale drains them.
        /// </summary>
        private static List<StockExportGdLineDto> FifoBreakdown(
            GdFifoValuation.Result res, List<StockGdDetailDto> details)
        {
            string? Claim(string gd)
            {
                var months = details.Where(d => string.Equals(d.GdNumber, gd, StringComparison.OrdinalIgnoreCase)
                        && d.Quantity.HasValue)
                    .Select(d => d.ClaimMonth).Distinct().OrderBy(m => m ?? DateTime.MaxValue).ToList();
                if (months.Count == 0 || months.All(m => m == null)) return null;
                return string.Join(" / ", months.Select(m => m?.ToString("MMM yyyy",
                    System.Globalization.CultureInfo.InvariantCulture) ?? "-"));
            }
            StockExportGdLineDto Line(string gd, IEnumerable<GdFifoValuation.Pool> pools, string? description)
            {
                var list = pools.ToList();
                var inValue = list.Sum(p => p.InValue);
                return new StockExportGdLineDto
                {
                    GdNumber = gd,
                    GdDate = list.Where(p => p.GdNumber != null).Min(p => p.OrderDate),
                    ClaimText = list.Any(p => p.GdNumber != null) ? Claim(gd) : null,
                    Description = description ?? string.Join(" / ", list.Select(p => p.Description)
                        .Where(n => !string.IsNullOrWhiteSpace(n)).Distinct(StringComparer.OrdinalIgnoreCase)),
                    Quantity = list.Sum(p => p.InQuantity),
                    ValueExcludingTax = Money(inValue),
                    SalesTaxRate = inValue > 0m ? Math.Round(list.Sum(p => p.InValue * p.Rate) / inValue, 4)
                        : list.FirstOrDefault()?.Rate,
                    ConsumedQuantity = list.Sum(p => p.ConsumedQuantity),
                    ConsumedValueExcludingTax = Money(list.Sum(p => p.ConsumedValue)),
                    BalanceQuantity = list.Sum(p => p.Quantity),
                    BalanceValueExcludingTax = Money(list.Sum(p => p.Value)),
                };
            }

            var lines = new List<StockExportGdLineDto>();
            // Pools a restatement replaced describe stock no longer held; the
            // restated lines (and anything since) are the item's GDs now.
            foreach (var g in res.Pools.Where(p => p.GdNumber != null && p.InQuantity > 0m && p.RestatedAwayQuantity == 0m)
                         .GroupBy(p => p.GdNumber!, StringComparer.OrdinalIgnoreCase)
                         .OrderBy(g => g.Min(p => p.OrderDate) ?? DateTime.MaxValue).ThenBy(g => g.Key))
                lines.Add(Line(g.Key, g, null));
            var untraced = res.Pools.Where(p => p.Kind == GdFifoValuation.PoolKind.OpeningUntraced && p.RestatedAwayQuantity == 0m).ToList();
            if (untraced.Count > 0) lines.Add(Line("-", untraced, "Opening — not traced to a GD"));
            var inward = res.Pools.Where(p => p.Kind == GdFifoValuation.PoolKind.Inward && p.InQuantity > 0m && p.RestatedAwayQuantity == 0m).ToList();
            if (inward.Count > 0) lines.Add(Line("-", inward, "Other stock in (purchase / receipt / adjustment)"));
            if (res.ShortfallQuantity > 0m)
                lines.Add(new StockExportGdLineDto
                {
                    GdNumber = "-",
                    Description = "Sold beyond stock — not covered by a GD yet",
                    ConsumedQuantity = res.ShortfallQuantity,
                    ConsumedValueExcludingTax = res.ShortfallValue,
                    BalanceQuantity = -res.ShortfallQuantity,
                    BalanceValueExcludingTax = -res.ShortfallValue,
                });
            return lines;
        }

        /// <summary>A movement's FIFO slices, labelled for the screen.</summary>
        private static List<StockMovementAllocationDto> AllocationsFor(
            GdFifoValuation.Result result, int movementId, DateTime movementDate)
        {
            if (!result.Takes.TryGetValue(movementId, out var takes)) return new();
            var pools = result.Pools.ToDictionary(p => p.Key);
            var month = new DateTime(movementDate.Year, movementDate.Month, 1);
            return takes.Select(t =>
            {
                pools.TryGetValue(t.PoolKey, out var p);
                return new StockMovementAllocationDto
                {
                    GdNumber = p?.GdNumber,
                    Label = PoolLabel(p, t.PoolKey),
                    GdDate = p?.OrderDate,
                    Claimed = p != null && GdFifoValuation.ClaimedFor(p, month),
                    Quantity = t.Quantity,
                    ValueExcludingTax = t.Value,
                };
            }).ToList();
        }

        private async Task<List<StockGdDetailDto>> BuildGdDetailsAsync(int companyId, List<int>? itemTypeIds)
        {
            if (itemTypeIds is { Count: 0 }) return new();
            var lotsQuery = _context.OpeningStockLots.AsNoTracking()
                .Where(l => l.OpeningStockBalance.CompanyId == companyId
                    && l.LotRef != null && l.LotRef != "");
            var linesQuery = _context.ImportConsignmentLines.AsNoTracking()
                .Where(l => l.ImportConsignment.CompanyId == companyId
                    && l.ItemTypeId != null
                    && (l.Disposition == GdCostingDisposition.CostOnly
                        || l.Disposition == GdCostingDisposition.StockPosted));
            if (itemTypeIds != null)
            {
                lotsQuery = lotsQuery.Where(l => itemTypeIds.Contains(l.OpeningStockBalance.ItemTypeId));
                linesQuery = linesQuery.Where(l => itemTypeIds.Contains(l.ItemTypeId!.Value));
            }

            var lots = await lotsQuery.Select(l => new
            {
                ItemTypeId = l.OpeningStockBalance.ItemTypeId, l.Id, l.ClaimMonth,
                l.SourceRow, l.ItemNameOnSheet, l.HsCode, l.LotRef, l.LotDate,
                l.BalanceQuantity, l.BalanceValueExcludingTax, l.BalanceSalesTaxRate,
            }).ToListAsync();
            var lines = await linesQuery.Select(l => new
            {
                ItemTypeId = l.ItemTypeId!.Value, l.Id, l.ClaimMonth, l.SourceRow, l.DescriptionOnSheet,
                l.HsCode, l.Quantity, l.SellingValueExcludingTax, l.SalesTaxRate,
                l.Disposition, l.ImportConsignment.Mode, l.ImportConsignment.GdNumber,
                l.ImportConsignment.GdDate,
            }).ToListAsync();
            var restateItemQ = _context.StockRestatementLines.AsNoTracking().Where(l => l.CompanyId == companyId);
            if (itemTypeIds != null) restateItemQ = restateItemQ.Where(l => itemTypeIds.Contains(l.ItemTypeId));
            var restateItemIds = await restateItemQ.Select(l => l.ItemTypeId).Distinct().ToListAsync();
            var ids = lots.Select(l => l.ItemTypeId).Concat(lines.Select(l => l.ItemTypeId))
                .Concat(restateItemIds).Distinct().ToList();
            if (ids.Count == 0) return new();
            var names = await _context.ItemTypes.AsNoTracking()
                .Where(i => ids.Contains(i.Id) && !i.IsDeleted)
                .Select(i => new { i.Id, i.Name })
                .ToDictionaryAsync(i => i.Id, i => i.Name);
            foreach (var (id, own) in await CompanyItemNames.ForCompanyAsync(_context, companyId, ids))
                if (names.ContainsKey(id)) names[id] = own;
            var claimRows = await _context.GdClaimPeriods.AsNoTracking()
                .Where(x => x.CompanyId == companyId)
                .Select(x => new { x.GdNumber, x.ClaimMonth }).ToListAsync();
            var claims = claimRows.ToDictionary(x => x.GdNumber.Trim(), x => x.ClaimMonth,
                StringComparer.OrdinalIgnoreCase);
            DateTime? ClaimFor(string gd) => claims.TryGetValue(gd, out var month) ? month : null;

            var result = new List<StockGdDetailDto>();
            foreach (var l in lots)
            {
                if (!names.TryGetValue(l.ItemTypeId, out var name)) continue;
                var gd = l.LotRef!.Trim();
                result.Add(new StockGdDetailDto
                {
                    ItemTypeId = l.ItemTypeId, ItemTypeName = name, HsCode = l.HsCode,
                    Source = "Opening sheet", GdNumber = gd, GdDate = l.LotDate,
                    LotId = l.Id,
                    // The line's own month first; the GD-level month covers a
                    // line imported before lines carried one.
                    ClaimMonth = l.ClaimMonth ?? ClaimFor(gd), SourceRow = l.SourceRow,
                    Description = l.ItemNameOnSheet, Quantity = l.BalanceQuantity,
                    ValueExcludingTax = l.BalanceValueExcludingTax,
                    SalesTaxRate = l.BalanceSalesTaxRate,
                });
            }
            foreach (var l in lines)
            {
                if (!names.TryGetValue(l.ItemTypeId, out var name)) continue;
                var arrival = l.Mode == GdCostingImportModeNames.NewArrivals;
                var gd = l.GdNumber.Trim();
                result.Add(new StockGdDetailDto
                {
                    ItemTypeId = l.ItemTypeId, ItemTypeName = name, HsCode = l.HsCode,
                    Source = arrival ? "GD new arrival" : "Cost-only backfill",
                    GdNumber = gd, GdDate = l.GdDate,
                    ConsignmentLineId = l.Id,
                    ClaimMonth = l.ClaimMonth ?? ClaimFor(gd), SourceRow = l.SourceRow,
                    Description = l.DescriptionOnSheet,
                    Quantity = arrival ? l.Quantity : null,
                    ValueExcludingTax = arrival ? l.SellingValueExcludingTax : null,
                    SalesTaxRate = l.SalesTaxRate,
                });
            }
            // A stock-sheet restatement (CLAUDE.md 5b-17) is now what explains
            // the item's position: its latest restatement's lines replace the
            // older source rows, which describe stock that was restated away.
            var restateQ = _context.StockRestatementLines.AsNoTracking().Where(l => l.CompanyId == companyId);
            if (itemTypeIds != null) restateQ = restateQ.Where(l => itemTypeIds.Contains(l.ItemTypeId));
            var restated = (await restateQ.ToListAsync())
                .GroupBy(l => l.ItemTypeId)
                .ToDictionary(g => g.Key, g => g.Where(l => l.StockMovementId == g.Max(x => x.StockMovementId)).ToList());
            if (restated.Count > 0)
            {
                var missing = restated.Keys.Where(k => !names.ContainsKey(k)).ToList();
                if (missing.Count > 0)
                    foreach (var extra in await _context.ItemTypes.AsNoTracking()
                                 .Where(i => missing.Contains(i.Id) && !i.IsDeleted)
                                 .Select(i => new { i.Id, i.Name }).ToListAsync())
                        names[extra.Id] = extra.Name;
                result.RemoveAll(r => restated.ContainsKey(r.ItemTypeId));
                foreach (var (itemId, rlines) in restated)
                {
                    if (!names.TryGetValue(itemId, out var name)) continue;
                    foreach (var l in rlines)
                        result.Add(new StockGdDetailDto
                        {
                            ItemTypeId = itemId, ItemTypeName = name, Source = "Stock sheet restatement",
                            GdNumber = l.GdNumber, GdDate = l.GdDate, ClaimMonth = l.ClaimMonth,
                            RestatementLineId = l.Id, SourceRow = l.SourceRow, Description = l.Description,
                            Quantity = l.Quantity, ValueExcludingTax = l.ValueExcludingTax, SalesTaxRate = l.SalesTaxRate,
                        });
                }
            }

            // FIFO by GD: each stock line says what sales took from it and what
            // it still holds. A cost-only backfill line added no stock, so it
            // has no pool and stays as it was.
            var fifo = await FifoResultsAsync(companyId, ids);
            if (fifo != null)
            {
                foreach (var r in result)
                {
                    if (!fifo.TryGetValue(r.ItemTypeId, out var res)) continue;
                    var key = r.RestatementLineId is int rid ? $"restate-{rid}"
                        : r.LotId is int lid ? $"lot-{lid}"
                        : r.ConsignmentLineId is int cid && r.Quantity.HasValue ? $"arrival-{cid}" : null;
                    var pool = key == null ? null : res.Pools.FirstOrDefault(p => p.Key == key);
                    if (pool == null) continue;
                    r.ConsumedQuantity = pool.ConsumedQuantity;
                    r.ConsumedValueExcludingTax = Money(pool.ConsumedValue);
                    r.RemainingQuantity = pool.Quantity;
                    r.RemainingValueExcludingTax = Money(pool.Value);
                    // What the line's goods cost, sold and still held: a GD costing
                    // imported after the goods came in reaches the pool later, so
                    // InActualValue alone can read zero on a costed line.
                    r.ActualCostExcludingTax = Money(pool.ConsumedActualValue + pool.ActualValue);
                }
            }

            return result.OrderBy(r => r.ItemTypeName).ThenBy(r => r.GdDate)
                .ThenBy(r => r.GdNumber).ThenBy(r => r.SourceRow).ToList();
        }

        /// <summary>
        /// The dashboard's on-hand grid, and optionally the movement history
        /// behind every row.
        ///
        /// One method for both because the two answers come out of the SAME
        /// walk: a movement's cost is the weighted average standing when it
        /// happened, so the per-movement money only exists as a by-product of
        /// computing the item's position. Working them out twice would be two
        /// chances to disagree, and the export would then contradict the screen
        /// it was taken from.
        /// </summary>
        private async Task<(List<StockOnHandRowDto> Rows,
                            Dictionary<int, List<StockMovementRowDto>> Movements)>
            BuildOnHandAsync(int companyId, bool withMovements)
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

            var empty = new Dictionary<int, List<StockMovementRowDto>>();

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
            if (ids.Count == 0) return (new List<StockOnHandRowDto>(), empty);

            // Exclude soft-deleted item types: a deleted catalog row keeps its
            // StockMovements (delete doesn't block on movements — see
            // ItemTypeService.DeleteAsync), so without this filter a deleted
            // item still surfaced on the on-hand grid. Missing ids fall through
            // to `it == null → continue` below and drop out of the dashboard.
            var itemTypes = await _context.ItemTypes
                .Where(it => ids.Contains(it.Id) && !it.IsDeleted)
                .ToDictionaryAsync(it => it.Id);
            // The company's own names win over the shared catalog's.
            var ownNames = await CompanyItemNames.ForCompanyAsync(_context, companyId, ids);

            var openings = await _context.OpeningStockBalances
                .Where(o => o.CompanyId == companyId && ids.Contains(o.ItemTypeId))
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Qty = g.Sum(o => o.Quantity),
                    Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax),
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

            // Weighted average or FIFO by GD, per the company's costing method.
            var costing = await StockCosting.LoadAsync(_context, companyId, ids);

            var rows = new List<StockOnHandRowDto>();
            var traced = withMovements ? new Dictionary<int, List<StockMovementRowDto>>() : empty;

            foreach (var id in ids)
            {
                var it = itemTypes.GetValueOrDefault(id);
                if (it == null) continue;
                // 2026-05-12: decimal opening + totalIn/Out matches the
                // promoted StockMovement / OpeningStockBalance columns.
                var open = openings.GetValueOrDefault(id);
                decimal opening = open?.Qty ?? 0m;
                var itemMovements = movementsByItem.GetValueOrDefault(id) ?? new List<StockMovement>();

                // The trace is only collected when someone is going to read it —
                // the dashboard's own grid does not need per-movement money, and
                // building a Step for every movement in the company would be
                // pure waste on the hot path.
                var trace = withMovements ? new List<StockValuation.Step>() : null;

                var position = costing.Compute(id,
                    opening,
                    open?.Value ?? 0m,
                    open?.ActualCost ?? 0m,
                    open?.Rate ?? 0m,
                    itemMovements,
                    trace);

                rows.Add(new StockOnHandRowDto
                {
                    ItemTypeId = id,
                    ItemTypeName = CompanyItemNames.Pick(ownNames, id, it.Name),
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
                    // The opening's own value, straight from the stored opening
                    // balance -- the same figure fed into the walk above, so the
                    // column cannot disagree with what the valuation used.
                    OpeningValueExcludingTax = open?.Value ?? 0m,
                    // Already computed by the walk (StockValuation.Position):
                    // an inward movement's value is its stated cost or the
                    // running average, an outward movement's is the average
                    // standing when it happened. Never recomputed here.
                    ValueIn = position.ValueIn,
                    ValueOut = position.ValueOut,
                    // Actual-cost pool, from the SAME walk -- depletes as stock
                    // sells exactly like ValueExcludingTax does. Margin /
                    // MarginPercent are derived on the DTO itself.
                    ActualCostExcludingTax = position.ActualValueExcludingTax,
                    ActualUnitCost = Math.Round(position.ActualUnitCost, 4),
                    // The opening's own landed cost, straight from the stored
                    // balance -- the same figure fed into the walk above, so the
                    // two cannot disagree. With it, opening minus on-hand is the
                    // cost of what has gone out.
                    OpeningActualCostExcludingTax = open?.ActualCost ?? 0m,
                    LastMovementAt = lastDates.TryGetValue(id, out var d) ? d : null,
                });

                if (!withMovements) continue;

                var steps = trace!.ToDictionary(st => st.MovementId);
                // Oldest first, in the SAME order the walk applied them, so the
                // running figures on each line follow on from the one above.
                traced[id] = itemMovements
                    .OrderBy(m => m.MovementDate).ThenBy(m => m.Id)
                    .Select(m => new StockMovementRowDto
                    {
                        Id = m.Id,
                        ItemTypeId = m.ItemTypeId,
                        ItemTypeName = CompanyItemNames.Pick(ownNames, id, it.Name),
                        Direction = m.Direction.ToString(),
                        Quantity = m.Quantity,
                        SourceType = m.SourceType.ToString(),
                        SourceId = m.SourceId,
                        MovementDate = m.MovementDate,
                        Notes = m.Notes,
                        UnitCost = steps.TryGetValue(m.Id, out var st)
                            ? Math.Round(st.UnitCost, 4, MidpointRounding.AwayFromZero) : 0m,
                        Value = steps.TryGetValue(m.Id, out var sv) ? sv.Amount : 0m,
                        RunningQuantity = steps.TryGetValue(m.Id, out var sq) ? sq.RunningQuantity : 0m,
                        RunningValue = steps.TryGetValue(m.Id, out var sr) ? sr.RunningValue : 0m,
                        ActualUnitCost = steps.TryGetValue(m.Id, out var sa)
                            ? Math.Round(sa.ActualUnitCost, 4, MidpointRounding.AwayFromZero) : 0m,
                        RunningActualValue = steps.TryGetValue(m.Id, out var sra) ? sra.RunningActualValue : 0m,
                        ActualValue = steps.TryGetValue(m.Id, out var sav)
                            ? Math.Round(sav.ActualUnitCost * m.Quantity, 2, MidpointRounding.AwayFromZero) : 0m,
                    })
                    .ToList();
            }

            if (withMovements)
                await AttachSourceNumbersAsync(traced.Values.SelectMany(v => v).ToList());

            // Actual (landed) cost and margin are gated SEPARATELY from seeing
            // stock at all (stock.actualcost.view — CLAUDE.md 5b-2/PermissionCatalog:
            // "somebody who prices and sells does not automatically see the
            // margin"). The grid, the Excel export and the movements
            // drill-down (GetMovements, below) all ultimately read from here or
            // share the same walk, so redacting once, on the DTOs themselves,
            // reaches every surface rather than trusting each caller to ask.
            // Nulled, not zeroed: zero already means "no actual cost imported"
            // (see the DTO's own doc comment), and zeroing here would make
            // Margin read as the full selling value -- a redacted row must not
            // look like a 100% margin.
            if (!await _permission.HasPermissionAsync(CurrentUserId, "stock.actualcost.view"))
            {
                foreach (var row in rows)
                {
                    row.ActualCostExcludingTax = null;
                    row.OpeningActualCostExcludingTax = null;
                    row.ActualUnitCost = null;
                }
                if (withMovements)
                {
                    foreach (var list in traced.Values)
                        foreach (var m in list)
                        {
                            m.ActualUnitCost = null;
                            m.RunningActualValue = null;
                            m.ActualValue = null;
                        }
                }
            }

            return (rows.OrderBy(r => r.ItemTypeName).ToList(), traced);
        }

        /// <summary>
        /// Fill in the human-facing document number for each movement's source.
        /// <c>SourceId</c> is the internal PK and must never be shown, so this
        /// resolves it in one batched query per source type.
        /// </summary>
        private async Task AttachSourceNumbersAsync(List<StockMovementRowDto> rows)
        {
            if (rows.Count == 0) return;

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
            // A GD arrival names its GD, the reference the operator files under.
            var gdLineIds = rows.Where(r => r.SourceType == nameof(StockMovementSourceType.ImportConsignment) && r.SourceId.HasValue)
                                .Select(r => r.SourceId!.Value).Distinct().ToList();
            var gdNums = gdLineIds.Count == 0 ? new Dictionary<int, string>()
                : await _context.ImportConsignmentLines.Where(l => gdLineIds.Contains(l.Id))
                    .Select(l => new { l.Id, l.ImportConsignment.GdNumber })
                    .ToDictionaryAsync(x => x.Id, x => x.GdNumber);

            foreach (var r in rows)
            {
                if (!r.SourceId.HasValue) continue;
                if (r.SourceType == nameof(StockMovementSourceType.Invoice) && invNums.TryGetValue(r.SourceId.Value, out var iNo))
                    r.SourceDocNumber = iNo.ToString();
                else if (r.SourceType == nameof(StockMovementSourceType.PurchaseBill) && billNums.TryGetValue(r.SourceId.Value, out var pNo))
                    r.SourceDocNumber = pNo.ToString();
                else if (r.SourceType == nameof(StockMovementSourceType.GoodsReceipt) && grNums.TryGetValue(r.SourceId.Value, out var gNo))
                    r.SourceDocNumber = gNo.ToString();
                else if (r.SourceType == nameof(StockMovementSourceType.ImportConsignment) && gdNums.TryGetValue(r.SourceId.Value, out var gd))
                    r.SourceDocNumber = gd;
            }
        }

        /// <summary>
        /// The whole on-hand dashboard as a styled .xlsx: one row per item with
        /// Opening / In / Out / On-Hand and the money behind them (Excluding,
        /// Tax Rate, Sales Tax, Including), each item's movement history nested
        /// underneath as a COLLAPSED Excel outline group.
        ///
        /// Exports the whole filtered set, not a page — the grid is client-paged
        /// precisely because one request already values every row, so there is
        /// nothing to page through here either.
        ///
        /// Movement detail is a separate capability from seeing the totals, so
        /// it is included only when the caller also holds
        /// <c>stock.movements.view</c>; the workbook says on its face when it
        /// was left out, rather than shipping bare rows that look complete.
        /// </summary>
        [HttpGet("company/{companyId}/onhand/excel")]
        [HasPermission("stock.dashboard.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> ExportOnHand(int companyId, [FromQuery] string? search = null)
        {
            // The workbook is the client's customs-lot stock sheet — one row per
            // item, no movement drill-down — so the walk is asked for totals
            // only. That also drops the old stock.movements.view split: there is
            // no movement detail in the sheet for a second permission to gate.
            var (rows, _) = await BuildOnHandAsync(companyId, withMovements: false);
            await AttachGdNumbersAsync(companyId, rows);

            // Same match the dashboard's search box makes (name, HS code OR GD
            // number), so an operator who filtered the screen gets the sheet
            // they can see.
            var term = (search ?? "").Trim();
            if (term.Length > 0)
            {
                rows = rows
                    .Where(r => r.ItemTypeName.Contains(term, StringComparison.OrdinalIgnoreCase)
                             || (r.HSCode ?? "").Contains(term, StringComparison.OrdinalIgnoreCase)
                             || r.GdNumbers.Any(g => g.Contains(term, StringComparison.OrdinalIgnoreCase)))
                    .ToList();
            }

            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId)
                .Select(c => new { c.Name, c.BrandName })
                .FirstOrDefaultAsync();

            var filters = new List<string> { $"As at {PakistanClock.Today:dd-MM-yyyy}" };
            if (term.Length > 0) filters.Add($"Search: \"{term}\"");
            // Say so when the figures are a division's share rather than the
            // company's: a restricted user's export is a subset, and a sheet
            // that does not admit that is a wrong number waiting to be quoted.
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            if (divScope != null) filters.Add("Scope: your divisions only");

            var gdDetails = await BuildGdDetailsAsync(companyId, rows.Select(r => r.ItemTypeId).ToList());
            // FIFO by GD: what every GD gave up and still holds, so each ↳ row
            // can carry its own Consumed and Balance.
            var fifo = await FifoResultsAsync(companyId, rows.Select(r => r.ItemTypeId).ToList());
            if (fifo != null) filters.Add("Costing: FIFO by GD (claimed GDs first)");
            // Every GD behind an item, one entry per declaration in date order.
            // Stock sources first; an item priced only by a cost-only backfill
            // still names that GD rather than leaving the cell blank.
            var lots = gdDetails
                .GroupBy(d => d.ItemTypeId)
                .ToDictionary(g => g.Key, g =>
                {
                    var src = g.Any(d => d.Quantity.HasValue) ? g.Where(d => d.Quantity.HasValue) : g;
                    return src.GroupBy(d => d.GdNumber, StringComparer.OrdinalIgnoreCase)
                        .Select(x => (Gd: x.Key, Date: x.Min(d => d.GdDate), Claim: ClaimText(x)))
                        .OrderBy(x => x.Date ?? DateTime.MaxValue).ThenBy(x => x.Gd)
                        .ToList();
                });

            var data = new StockExportDto
            {
                CompanyName = company?.BrandName is { Length: > 0 } b ? b : company?.Name ?? "",
                Title = "Stock Valuation Report",
                GeneratedAt = PakistanClock.Now,
                FiltersApplied = filters,
                GdDetails = gdDetails,
                Items = rows.Select(r =>
                {
                    lots.TryGetValue(r.ItemTypeId, out var gds);
                    gds ??= new();
                    var item = new StockExportItemDto
                    {
                        Summary = r,
                        LotRef = gds.Count == 0 ? null : string.Join(", ", gds.Select(g => g.Gd)),
                    };
                    if (gds.Count == 1)
                    {
                        item.LotDate = gds[0].Date;
                        item.ClaimMonthsText = gds[0].Claim;
                    }
                    else if (gds.Count > 1)
                    {
                        // One breakdown row per GD, from the stock sources only
                        // — a cost-only backfill added no quantity to break down.
                        item.GdBreakdown = gdDetails
                            .Where(d => d.ItemTypeId == r.ItemTypeId && d.Quantity.HasValue)
                            .GroupBy(d => d.GdNumber, StringComparer.OrdinalIgnoreCase)
                            .Select(x => new StockExportGdLineDto
                            {
                                GdNumber = x.Key,
                                GdDate = x.Min(d => d.GdDate),
                                ClaimText = ClaimText(x),
                                Description = string.Join(" / ", x.Select(d => d.Description)
                                    .Where(n => !string.IsNullOrWhiteSpace(n))
                                    .Distinct(StringComparer.OrdinalIgnoreCase)),
                                Quantity = x.Sum(d => d.Quantity ?? 0m),
                                ValueExcludingTax = x.Sum(d => d.ValueExcludingTax ?? 0m),
                                SalesTaxRate = x.Select(d => d.SalesTaxRate).FirstOrDefault(v => v.HasValue),
                            })
                            .OrderBy(x => x.GdDate ?? DateTime.MaxValue).ThenBy(x => x.GdNumber)
                            .ToList();

                        // Unclaimed / undated GDs show as "-" so every position
                        // still lines up with its GD number.
                        item.LotDatesText = gds.Any(g => g.Date.HasValue)
                            ? string.Join(", ", gds.Select(g => g.Date?.ToString("dd-MM-yyyy") ?? "-"))
                            : null;
                        item.ClaimMonthsText = gds.Any(g => g.Claim != null)
                            ? string.Join(", ", gds.Select(g => g.Claim ?? "-"))
                            : null;
                    }
                    if (fifo != null && fifo.TryGetValue(r.ItemTypeId, out var res))
                    {
                        var breakdown = FifoBreakdown(res, gdDetails.Where(d => d.ItemTypeId == r.ItemTypeId).ToList());
                        // A single source needs no breakdown: the item row IS it.
                        if (breakdown.Count > 1) item.GdBreakdown = breakdown;
                    }
                    return item;
                }).ToList(),
            };

            byte[] bytes;
            try
            {
                bytes = StockExcelBuilder.Build(data);
            }
            catch (Exception ex)
            {
                // Never surface the exception text — it can carry schema detail.
                _logger.LogError(ex, "Stock Excel export failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "Could not build the Excel file. Please try again." });
            }

            var fileName = $"stock-report-{PakistanClock.Today:yyyy-MM-dd}.xlsx";

            // One item's lines under one GD can be claimed in different months;
            // every distinct month is named ("Jun 2026 / Jul 2026"), with a
            // dash when some of those lines are not claimed yet.
            static string? ClaimText(IEnumerable<StockGdDetailDto> lines)
            {
                var months = lines.Select(d => d.ClaimMonth).Distinct().OrderBy(m => m ?? DateTime.MaxValue).ToList();
                if (months.All(m => m == null)) return null;
                return string.Join(" / ", months.Select(m => m?.ToString("MMM yyyy",
                    System.Globalization.CultureInfo.InvariantCulture) ?? "-"));
            }
            return File(bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                fileName);
        }

        /// <summary>
        /// The client's MONTHLY stock sheet: one row per GD line (GD x product),
        /// with the HS code and value against it. Opening is the line's position
        /// on the first of the month plus anything that arrived during it,
        /// Consumed is what that month's outward movements took from it (FIFO
        /// cost, the same figure the ledger posts), Balance is its position at
        /// month end. Two walks over the same rows, cut at the two dates, so a
        /// month's Balance is the next month's Opening by construction.
        /// FIFO by GD only: under the weighted average a sale is not allocated
        /// to a GD, so a per-GD consumed figure would be invented.
        /// </summary>
        [HttpGet("company/{companyId}/onhand/excel/monthly")]
        [HasPermission("stock.dashboard.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> ExportMonthly(int companyId, [FromQuery] string? month,
            [FromQuery] string? search = null)
        {
            var (error, data) = await BuildMonthlyDataAsync(companyId, month, search);
            if (error != null) return error;
            byte[] bytes;
            try
            {
                bytes = StockExcelBuilder.BuildMonthly(data);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Monthly stock Excel export failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "Could not build the Excel file. Please try again." });
            }
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"stock-sheet-{data!.Month:yyyy-MM}.xlsx");
        }

        /// <summary>
        /// Annex-H1 (SRO 55(I)/2025) for a month: the monthly GD sheet's lines
        /// rolled up per HS code x unit x rate, at cost (stock value excluding
        /// tax). Built from the SAME data as the monthly sheet, so the two -- and
        /// the stock screen -- cannot disagree. See <see cref="AnnexH1"/>.
        /// </summary>
        [HttpGet("company/{companyId}/annex-h1/excel")]
        [HasPermission("stock.dashboard.export")]
        [AuthorizeCompany]
        public async Task<IActionResult> ExportAnnexH1(int companyId, [FromQuery] string? month)
        {
            var (error, data) = await BuildMonthlyDataAsync(companyId, month, null);
            if (error != null) return error;
            var rows = AnnexH1.Build(data!.Lines);
            var notes = new List<string>(data.FiltersApplied);
            if (data.LaterLinesOmitted > 0)
                notes.Add($"{data.LaterLinesOmitted} GD line(s) dated after this month are not included.");
            if (data.RestatedInMonth)
                notes.Add("A stock-sheet restatement was applied this month; its value change is in Other.");
            byte[] bytes;
            try
            {
                bytes = AnnexH1.BuildWorkbook(data.CompanyName, data.Month, rows, notes);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Annex-H1 export failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "Could not build the Excel file. Please try again." });
            }
            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"annex-h1-{data.Month:yyyy-MM}.xlsx");
        }

        /// <summary>The monthly sheet's data for <paramref name="month"/> -- or the
        /// request's error. Shared by the monthly sheet and Annex-H1.</summary>
        private async Task<(IActionResult? Error, StockMonthlyExportDto? Data)> BuildMonthlyDataAsync(
            int companyId, string? month, string? search)
        {
            if (!DateTime.TryParseExact(month ?? "", "yyyy-MM", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out var monthStart))
                return (BadRequest(new { message = "Choose a month (yyyy-MM)." }), null);
            var today = PakistanClock.Today;
            if (monthStart > new DateTime(today.Year, today.Month, 1))
                return (BadRequest(new { message = "That month has not started yet." }), null);
            if (!await StockCostingMethod.IsGdFifoAsync(_context, companyId))
                return (BadRequest(new { message =
                    "The monthly GD sheet needs FIFO-by-GD costing: under the weighted average a sale is not allocated to a GD." }), null);
            var monthEnd = monthStart.AddMonths(1);

            var (rows, _) = await BuildOnHandAsync(companyId, withMovements: false);
            var term = (search ?? "").Trim();
            if (term.Length > 0)
            {
                await AttachGdNumbersAsync(companyId, rows);
                rows = rows
                    .Where(r => r.ItemTypeName.Contains(term, StringComparison.OrdinalIgnoreCase)
                             || (r.HSCode ?? "").Contains(term, StringComparison.OrdinalIgnoreCase)
                             || r.GdNumbers.Any(g => g.Contains(term, StringComparison.OrdinalIgnoreCase)))
                    .ToList();
            }
            var ids = rows.Select(r => r.ItemTypeId).ToList();

            var atStart = await FifoResultsBeforeAsync(companyId, ids, monthStart);
            var atEnd = await FifoResultsBeforeAsync(companyId, ids, monthEnd);
            var canSeeActual = await _permission.HasPermissionAsync(CurrentUserId, "stock.actualcost.view");

            // Each GD line's own HS code: two products under one item can be
            // filed under different codes, and the sheet states the line's.
            var lotHs = await _context.OpeningStockLots.AsNoTracking()
                .Where(l => l.OpeningStockBalance.CompanyId == companyId)
                .Select(l => new { l.Id, l.HsCode }).ToDictionaryAsync(l => l.Id, l => l.HsCode);
            var lineHs = await _context.ImportConsignmentLines.AsNoTracking()
                .Where(l => l.ImportConsignment.CompanyId == companyId)
                .Select(l => new { l.Id, l.HsCode }).ToDictionaryAsync(l => l.Id, l => l.HsCode);

            var data = new StockMonthlyExportDto { Month = monthStart, GeneratedAt = PakistanClock.Now };
            if (atStart != null && atEnd != null)
            {
                var movesInMonth = atEnd.Value.Movements.Values
                    .Where(m => m.MovementDate >= monthStart && m.MovementDate < monthEnd).ToList();
                var revalIds = movesInMonth.Where(m => m.SourceType == StockMovementSourceType.Revaluation)
                    .Select(m => m.Id).ToList();
                data.RestatedInMonth = revalIds.Count > 0 && await _context.StockRestatementLines.AsNoTracking()
                    .AnyAsync(l => l.CompanyId == companyId && revalIds.Contains(l.StockMovementId));

                var sheet = StockMonthlySheet.Build(monthStart,
                    rows.Select(r => new StockMonthlySheet.ItemInfo(r.ItemTypeId, r.ItemTypeName, r.HSCode, r.UOM, r.SalesTaxRate)),
                    atStart.Value.Results, atEnd.Value.Results, movesInMonth, lotHs, lineHs, canSeeActual);
                data.Lines = sheet.Lines;
                data.LaterLinesOmitted = sheet.LaterLinesOmitted;
                data.LaterLinesValue = sheet.LaterLinesValue;
            }

            var company = await _context.Companies.AsNoTracking()
                .Where(c => c.Id == companyId).Select(c => new { c.Name, c.BrandName }).FirstOrDefaultAsync();
            data.CompanyName = company?.BrandName is { Length: > 0 } b ? b : company?.Name ?? "";
            data.FiltersApplied.Add("Costing: FIFO by GD (claimed GDs first)");
            if (term.Length > 0) data.FiltersApplied.Add($"Search: \"{term}\"");
            if (await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId) != null)
                data.FiltersApplied.Add("Scope: your divisions only");
            if (monthEnd > today) data.FiltersApplied.Add($"Month in progress: movements to {today:dd-MM-yyyy}");

            return (null, data);
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

            var movementNames = await CompanyItemNames.ForCompanyAsync(
                _context, companyId, rows.Select(r => r.ItemTypeId));
            foreach (var row in rows)
                row.ItemTypeName = CompanyItemNames.Pick(movementNames, row.ItemTypeId, row.ItemTypeName);

            // Resolve human-facing document numbers for the source rows — one
            // batched query per source type, shared with the Excel export so
            // the two cannot label the same movement differently.
            await AttachSourceNumbersAsync(rows);

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
                        ActualCost = g.Sum(o => o.ActualCostExcludingTax),
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

                var costing = await StockCosting.LoadAsync(_context, companyId, pageItemIds);
                var steps = new Dictionary<int, StockValuation.Step>();
                var fifo = new Dictionary<int, GdFifoValuation.Result>();
                foreach (var grp in history.GroupBy(m => m.ItemTypeId))
                {
                    var open = histOpenings.GetValueOrDefault(grp.Key);
                    var trace = new List<StockValuation.Step>();
                    if (costing.IsFifo)
                        fifo[grp.Key] = costing.Detailed(grp.Key, open?.Qty ?? 0m, open?.Value ?? 0m,
                            open?.ActualCost ?? 0m, open?.Rate ?? 0m, grp.ToList(), trace);
                    else
                        StockValuation.Compute(open?.Qty ?? 0m, open?.Value ?? 0m, open?.ActualCost ?? 0m,
                                               open?.Rate ?? 0m, grp.ToList(), trace);
                    foreach (var st in trace) steps[st.MovementId] = st;
                }

                foreach (var r in rows)
                {
                    if (fifo.TryGetValue(r.ItemTypeId, out var res))
                        r.Allocations = AllocationsFor(res, r.Id, r.MovementDate);
                    if (!steps.TryGetValue(r.Id, out var st)) continue;
                    r.UnitCost = Math.Round(st.UnitCost, 4, MidpointRounding.AwayFromZero);
                    r.Value = st.Amount;
                    r.RunningQuantity = st.RunningQuantity;
                    r.RunningValue = st.RunningValue;
                    r.ActualUnitCost = Math.Round(st.ActualUnitCost, 4, MidpointRounding.AwayFromZero);
                    r.RunningActualValue = st.RunningActualValue;
                    r.ActualValue = Math.Round(st.ActualUnitCost * r.Quantity, 2, MidpointRounding.AwayFromZero);
                }
            }

            // Same stock.actualcost.view gate BuildOnHandAsync applies to the
            // grid and the export — this is the movements drill-down's own,
            // separate code path (it does not call BuildOnHandAsync), so it
            // needs its own redaction. Nulled, never zeroed — see the note in
            // BuildOnHandAsync.
            if (!await _permission.HasPermissionAsync(CurrentUserId, "stock.actualcost.view"))
            {
                foreach (var r in rows)
                {
                    r.ActualUnitCost = null;
                    r.RunningActualValue = null;
                    r.ActualValue = null;
                }
            }

            return Ok(new PagedResult<StockMovementRowDto>
            {
                Items = rows,
                TotalCount = total,
                Page = clampedPage,
                PageSize = size,
            });
        }

        /// <summary>
        /// An item's cost history — every recorded change to its actual cost,
        /// quantity and selling value, newest first. The drill-down behind the
        /// On-Hand tab's Actual Cost column.
        ///
        /// Gated on <c>stock.actualcost.view</c>, not on seeing stock: the rows
        /// ARE landed cost and margin, so anything softer would hand out through
        /// the history exactly what the grid redacts (the defect fixed in
        /// b1cb30d). Omitting <paramref name="itemTypeId"/> gives the whole
        /// company's history — that is how a bad import is found when the
        /// operator does not yet know which item went wrong.
        /// </summary>
        [HttpGet("company/{companyId}/cost-changes")]
        [HasPermission("stock.actualcost.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<StockCostChangeDto>>> GetCostChanges(
            int companyId, [FromQuery] int? itemTypeId = null,
            [FromQuery] int page = 1, [FromQuery] int? pageSize = null)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _costAudit.GetPagedAsync(companyId, itemTypeId, page, pageSize));
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
                    ActualCostExcludingTax = o.ActualCostExcludingTax,
                    AsOfDate = o.AsOfDate,
                    Notes = o.Notes,
                })
                .ToListAsync();
            var openingNames = await CompanyItemNames.ForCompanyAsync(
                _context, companyId, rows.Select(r => r.ItemTypeId));
            foreach (var row in rows)
                row.ItemTypeName = CompanyItemNames.Pick(openingNames, row.ItemTypeId, row.ItemTypeName);
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
            // The item must already be one this company may see (CLAUDE.md
            // §5b-2b). Writing a balance or movement against another tenant's
            // item would REGISTER it here and pull it into this company's pickers.
            if (!await ItemTypeMembership.IsVisibleAsync(_context, dto.ItemTypeId, new[] { dto.CompanyId }))
                return NotFound(new { error = "Item type not found." });
            var existing = await _context.OpeningStockBalances
                .FirstOrDefaultAsync(o => o.CompanyId == dto.CompanyId && o.ItemTypeId == dto.ItemTypeId);
            // Snapshot BEFORE anything is assigned. A new row starts at zero on
            // all three figures, which is exactly what "not known" has always
            // meant here, so a first entry reads as 0 -> the figure entered
            // rather than as a change out of nowhere.
            var before = existing == null
                ? new StockFigures(0m, 0m, 0m)
                : new StockFigures(existing.Quantity, existing.ActualCostExcludingTax, existing.ValueExcludingTax);
            var isNew = existing == null;

            if (existing == null)
            {
                existing = new OpeningStockBalance
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    Quantity = dto.Quantity,
                    ValueExcludingTax = dto.ValueExcludingTax,
                    SalesTaxRate = dto.SalesTaxRate,
                    ActualCostExcludingTax = dto.ActualCostExcludingTax ?? 0m,
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
                // Nullable: null means the caller did not mention cost, so the
                // row keeps whatever it already had. Only a supplied value
                // (including 0, which clears it) overwrites.
                if (dto.ActualCostExcludingTax is decimal actual)
                    existing.ActualCostExcludingTax = actual;
                existing.AsOfDate = dto.AsOfDate.Date;
                existing.Notes = dto.Notes;
            }

            // Recorded in the SAME SaveChanges as the change itself, so a
            // history entry can never survive a write that rolled back.
            await _costAudit.RecordAsync(
                dto.CompanyId, dto.ItemTypeId, existing.Id, CurrentUserId,
                StockCostChangeSources.OpeningBalanceEdit,
                isNew ? "Created" : "Edited",
                before,
                new StockFigures(existing.Quantity, existing.ActualCostExcludingTax, existing.ValueExcludingTax),
                note: isNew
                    ? "Opening balance entered on the Opening Balances tab."
                    : "Opening balance edited on the Opening Balances tab.");

            await _context.SaveChangesAsync();

            // Opening stock entered by hand has to reach the Inventory control
            // account, exactly as the two spreadsheet importers' does. Without
            // this the account sits below what the stock walk says the goods are
            // worth, which is the same defect the costing import had — found
            // here by the COGS invariant test on 2026-09-17.
            //
            // The DELTA, not the value: this is an upsert, so an edit from
            // 100,000 to 120,000 moves the account by 20,000.
            await _posting.AdjustInventoryOpeningAsync(
                dto.CompanyId, existing.ValueExcludingTax - before.Value);

            // A new opening position re-prices every sale after it.
            await _stock.RepostInventoryPeriodsAsync(dto.CompanyId, null);

            var it = await _context.ItemTypes.FindAsync(existing.ItemTypeId);
            return Ok(new OpeningStockBalanceDto
            {
                Id = existing.Id,
                CompanyId = existing.CompanyId,
                ItemTypeId = existing.ItemTypeId,
                ItemTypeName = CompanyItemNames.Pick(
                    await CompanyItemNames.ForCompanyAsync(_context, existing.CompanyId, new[] { existing.ItemTypeId }),
                    existing.ItemTypeId, it?.Name ?? ""),
                Quantity = existing.Quantity,
                ValueExcludingTax = existing.ValueExcludingTax,
                SalesTaxRate = existing.SalesTaxRate,
                ActualCostExcludingTax = existing.ActualCostExcludingTax,
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

            // Recorded BEFORE the row goes: once it is removed there is nothing
            // left to read the figures off, and "where did this item's opening
            // cost go" is precisely the question this table answers.
            await _costAudit.RecordAsync(
                row.CompanyId, row.ItemTypeId, row.Id, CurrentUserId,
                StockCostChangeSources.OpeningBalanceDelete, "Deleted",
                new StockFigures(row.Quantity, row.ActualCostExcludingTax, row.ValueExcludingTax),
                new StockFigures(0m, 0m, 0m),
                note: "Opening balance row deleted.");

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
            // The item must already be one this company may see (CLAUDE.md
            // §5b-2b). Writing a balance or movement against another tenant's
            // item would REGISTER it here and pull it into this company's pickers.
            if (!await ItemTypeMembership.IsVisibleAsync(_context, dto.ItemTypeId, new[] { dto.CompanyId }))
                return NotFound(new { error = "Item type not found." });

            var mode = string.Equals(dto.Mode, StockAdjustmentModes.Set, StringComparison.OrdinalIgnoreCase)
                ? StockAdjustmentModes.Set
                : StockAdjustmentModes.Delta;

            // Where the item stands right now, valued the one way stock is ever
            // valued. Needed by BOTH modes: "set" subtracts from it to find the
            // change, and "delta" checks the result against it.
            var current = await CurrentPositionAsync(dto.CompanyId, dto.ItemTypeId);

            decimal qtyDelta;
            decimal valueDelta;
            decimal actualValueDelta;
            decimal? unitCost = null;
            decimal? actualUnitCost = null;
            decimal? rate = null;

            if (mode == StockAdjustmentModes.Set)
            {
                if (dto.TargetQuantity is null && dto.TargetValueExcludingTax is null
                    && dto.TargetActualCostExcludingTax is null)
                    return BadRequest(new { error = "Say what the quantity, the value, or the actual cost should be." });

                var targetQty = dto.TargetQuantity ?? current.Quantity;
                var targetValue = dto.TargetValueExcludingTax ?? current.ValueExcludingTax;
                var targetActualCost = dto.TargetActualCostExcludingTax ?? current.ActualValueExcludingTax;

                if (targetQty < 0) return BadRequest(new { error = "On-hand cannot be negative." });
                if (targetValue < 0) return BadRequest(new { error = "Stock value cannot be negative." });
                if (targetActualCost < 0) return BadRequest(new { error = "Actual cost cannot be negative." });

                // Stock that has run out is worth exactly nothing, so a target
                // pairing zero quantity with money left over is refused rather
                // than silently discarded (CLAUDE.md 5b-4). Both pools keep the
                // same invariant, independently of each other.
                if (targetQty == 0 && targetValue > 0)
                    return BadRequest(new
                    {
                        error = "An on-hand of zero must be worth zero. Set the value to 0 as well, "
                              + "or give the quantity that is actually there."
                    });
                if (targetQty == 0 && targetActualCost > 0)
                    return BadRequest(new
                    {
                        error = "An on-hand of zero must have zero actual cost. Set the actual cost to 0 as well, "
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

                // MIRROR of the four branches above, against the ACTUAL pool's
                // own average — never the selling pool's. The two pools carry
                // different opening costs and different revaluation history, so
                // one predicted value cannot stand in for both; sharing the
                // selling pool's `average`/`predictedValue` here would silently
                // reproduce the exact bug CLAUDE.md 5b-4 already records once
                // (measuring against the CURRENT figure instead of the
                // post-movement one takes the pool down twice).
                var actualAverage = current.Quantity > 0m
                    ? current.ActualValueExcludingTax / current.Quantity
                    : 0m;
                decimal predictedActualValue;

                if (qtyDelta > 0m && targetActualCost > current.ActualValueExcludingTax)
                {
                    // Adding stock AND actual cost: the operator's own two
                    // figures say what the addition actually cost, so carry it
                    // on the movement and the actual average lands exactly
                    // where they said it should.
                    actualUnitCost = (targetActualCost - current.ActualValueExcludingTax) / qtyDelta;
                    predictedActualValue = targetActualCost;
                }
                else if (qtyDelta > 0m)
                {
                    // Adding stock while the actual cost stays put or falls: the
                    // movement states no actual cost, so the walk values it at
                    // the running actual average and the revaluation corrects
                    // the rest.
                    predictedActualValue = current.ActualValueExcludingTax + (qtyDelta * actualAverage);
                }
                else if (qtyDelta < 0m)
                {
                    // Stock leaving is costed at the actual average, and an
                    // emptied bin actually cost exactly zero — the same rule the
                    // walk applies to this pool too.
                    predictedActualValue = targetQty <= 0m
                        ? 0m
                        : current.ActualValueExcludingTax - (-qtyDelta * actualAverage);
                }
                else
                {
                    predictedActualValue = current.ActualValueExcludingTax;
                }

                actualValueDelta = Money(targetActualCost - Money(predictedActualValue));

                // FIFO by GD: the quantity movement is NOT valued at the average
                // -- stock leaves from the GD pools in claim order, and cost-less
                // stock arrives at the average of what is held -- so the
                // prediction above would land the correction on the wrong
                // figure. Predict it by running the company's own walk with the
                // movement added; the revaluation then closes the exact gap.
                if (qtyDelta != 0m && await StockCostingMethod.IsGdFifoAsync(_context, dto.CompanyId))
                {
                    var (fifoValue, fifoActual) = await PredictAfterMovementAsync(
                        dto.CompanyId, dto.ItemTypeId, qtyDelta, unitCost, actualUnitCost, dto.MovementDate.Date);
                    valueDelta = Money(targetValue - Money(fifoValue));
                    actualValueDelta = Money(targetActualCost - Money(fifoActual));
                }

                if (qtyDelta == 0m && valueDelta == 0m && actualValueDelta == 0m
                    && !(dto.SalesTaxRate is >= 0m and <= 100m && dto.SalesTaxRate != current.SalesTaxRate))
                    return BadRequest(new { error = "Those are already the figures on record — nothing to correct." });
            }
            else
            {
                qtyDelta = dto.Delta;
                valueDelta = Money(dto.ValueDelta ?? 0m);
                actualValueDelta = Money(dto.ActualValueDelta ?? 0m);

                if (qtyDelta == 0m && valueDelta == 0m && actualValueDelta == 0m)
                    return BadRequest(new { error = "Give a quantity change, a value change, an actual-cost change, or some combination." });

                if (qtyDelta > 0m && dto.UnitCostExcludingTax is > 0m)
                    unitCost = dto.UnitCostExcludingTax.Value;

                if (qtyDelta > 0m && dto.ActualUnitCostExcludingTax is > 0m)
                    actualUnitCost = dto.ActualUnitCostExcludingTax.Value;
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

            // Same floor on the actual-cost pool, independently.
            if (actualValueDelta < 0m && current.ActualValueExcludingTax + actualValueDelta < -0.005m)
            {
                return BadRequest(new
                {
                    error = $"That would take the actual cost below zero (currently "
                          + $"{current.ActualValueExcludingTax:N2}). Reduce the decrease."
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
                    // Actual-cost mirror of UnitCostExcludingTax above, under the
                    // identical contract: only an increase may state one, and
                    // only when a positive figure was actually given — stock
                    // leaving is always costed at the running ACTUAL average,
                    // never a stated figure (same invariant, own pool).
                    ActualUnitCostExcludingTax = qtyDelta > 0m && actualUnitCost is > 0m
                        ? Math.Round(actualUnitCost.Value, 4, MidpointRounding.AwayFromZero)
                        : null,
                    CreatedAt = DateTime.UtcNow,
                });
                written.Add(qtyDelta > 0m
                    ? $"quantity up {Math.Abs(qtyDelta):0.####}"
                    : $"quantity down {Math.Abs(qtyDelta):0.####}");
            }

            // A value-only (or actual-cost-only) correction: no goods moved, so
            // it is a revaluation row with zero quantity carrying the signed
            // money. The two pools are corrected independently — this row may
            // carry either delta, both, or neither (falling through to the rate
            // -only case below).
            if (valueDelta != 0m || actualValueDelta != 0m
                || (qtyDelta == 0m && rate.HasValue && rate != current.SalesTaxRate))
            {
                _context.StockMovements.Add(new StockMovement
                {
                    CompanyId = dto.CompanyId,
                    ItemTypeId = dto.ItemTypeId,
                    // The enum has no "neither" and the row carries no quantity,
                    // so the direction simply records which way the money went —
                    // the selling delta when it moved, else the actual delta, so
                    // an actual-only correction is not mislabelled by a zero
                    // selling delta that never changed.
                    Direction = (valueDelta != 0m ? valueDelta : actualValueDelta) >= 0m
                        ? StockMovementDirection.In : StockMovementDirection.Out,
                    Quantity = 0m,
                    SourceType = StockMovementSourceType.Revaluation,
                    SourceId = null,
                    MovementDate = dto.MovementDate.Date,
                    Notes = dto.Notes,
                    ValueAdjustmentExcludingTax = valueDelta,
                    ActualValueAdjustmentExcludingTax = actualValueDelta,
                    SalesTaxRate = rate,
                    CreatedAt = DateTime.UtcNow,
                });
                if (valueDelta != 0m)
                    written.Add($"value {(valueDelta > 0m ? "up" : "down")} {Math.Abs(valueDelta):N2}");
                if (actualValueDelta != 0m)
                    written.Add($"actual cost {(actualValueDelta > 0m ? "up" : "down")} {Math.Abs(actualValueDelta):N2}");
                if (valueDelta == 0m && actualValueDelta == 0m)
                    written.Add($"rate set to {rate:0.##}%");
            }

            if (written.Count == 0)
                return BadRequest(new { error = "Nothing to record." });

            // One transaction around the movements AND their audit record. The
            // record has to state the position the walk actually reached, and
            // that can only be read back after the movements are persisted --
            // so this is two SaveChanges, which is exactly the multi-step write
            // CLAUDE.md 4 says to wrap. Predicting the after-position instead
            // would put a figure in the history that no query can reproduce.
            await using var costTx = await _context.Database.BeginTransactionAsync();
            await _context.SaveChangesAsync();

            var after = await CurrentPositionAsync(dto.CompanyId, dto.ItemTypeId);

            await _costAudit.RecordAsync(
                dto.CompanyId, dto.ItemTypeId, null, CurrentUserId,
                StockCostChangeSources.StockAdjustment, mode,
                new StockFigures(current.Quantity, current.ActualValueExcludingTax, current.ValueExcludingTax),
                new StockFigures(after.Quantity, after.ActualValueExcludingTax, after.ValueExcludingTax),
                note: string.IsNullOrWhiteSpace(dto.Notes)
                    ? "Stock adjustment: " + string.Join(", ", written) + "."
                    : "Stock adjustment: " + string.Join(", ", written) + $". {dto.Notes}");
            await _context.SaveChangesAsync();

            // An adjustment or revaluation changes what stock is worth, so the
            // Inventory account has to follow it or it drifts above the walk.
            // Inside the transaction, so a rollback takes the entry with it.
            await _stock.RepostInventoryPeriodsAsync(dto.CompanyId, dto.MovementDate.Date);

            await costTx.CommitAsync();

            return Ok(new
            {
                message = "Adjustment recorded: " + string.Join(", ", written) + ".",
                quantity = after.Quantity,
                valueExcludingTax = after.ValueExcludingTax,
                salesTaxRate = after.SalesTaxRate,
                salesTax = after.SalesTax,
                valueIncludingTax = after.ValueIncludingTax,
                // Actual-cost pool, from the SAME position the response above
                // already reads — so the dialog's post-save figures can show
                // the resulting margin without a second round trip.
                actualCostExcludingTax = after.ActualValueExcludingTax,
                actualUnitCost = Math.Round(after.ActualUnitCost, 4, MidpointRounding.AwayFromZero),
                margin = after.Margin,
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

        /// <summary>
        /// Where one item's value and landed cost would stand after a quantity
        /// movement recorded now -- by running the company's own costing walk
        /// with that movement appended, so FIFO by GD predicts exactly what the
        /// walk will then do. Company-wide: adjustments are refused to
        /// division-restricted users, so there is no scope to apply.
        /// </summary>
        private async Task<(decimal Value, decimal Actual)> PredictAfterMovementAsync(
            int companyId, int itemTypeId, decimal qtyDelta, decimal? unitCost, decimal? actualUnitCost,
            DateTime movementDate)
        {
            var open = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId && o.ItemTypeId == itemTypeId)
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    Qty = g.Sum(o => o.Quantity), Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax), Rate = g.Max(o => o.SalesTaxRate),
                }).FirstOrDefaultAsync();
            var moves = await _context.StockMovements.AsNoTracking()
                .Where(m => m.CompanyId == companyId && m.ItemTypeId == itemTypeId).ToListAsync();
            moves.Add(new StockMovement
            {
                Id = int.MaxValue, CompanyId = companyId, ItemTypeId = itemTypeId,
                Direction = qtyDelta > 0m ? StockMovementDirection.In : StockMovementDirection.Out,
                Quantity = Math.Abs(qtyDelta), SourceType = StockMovementSourceType.Adjustment,
                MovementDate = movementDate,
                UnitCostExcludingTax = qtyDelta > 0m ? unitCost : null,
                ActualUnitCostExcludingTax = qtyDelta > 0m ? actualUnitCost : null,
            });
            var costing = await StockCosting.LoadAsync(_context, companyId, new[] { itemTypeId });
            var p = costing.Compute(itemTypeId, open?.Qty ?? 0m, open?.Value ?? 0m, open?.ActualCost ?? 0m,
                open?.Rate ?? 0m, moves);
            return (p.ValueExcludingTax, p.ActualValueExcludingTax);
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
        /// <summary>How this company values stock: WeightedAverage or GdFifo.</summary>
        [HttpGet("company/{companyId}/costing-method")]
        [HasPermission("stock.dashboard.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetCostingMethod(int companyId)
            => Ok(new { companyId, method = await StockCostingMethod.GetAsync(_context, companyId) });

        /// <summary>
        /// What switching method would do to this company's figures, item by
        /// item: the weighted-average position beside the FIFO-by-GD one. Reads
        /// only -- nothing is stored -- so it is safe to ask before switching.
        /// </summary>
        [HttpGet("company/{companyId}/costing-compare")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> CompareCostingMethods(int companyId)
        {
            var openings = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key,
                    Qty = g.Sum(o => o.Quantity),
                    Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax),
                    Rate = g.Max(o => o.SalesTaxRate),
                })
                .ToDictionaryAsync(x => x.ItemTypeId, x => x);
            var byItem = (await _context.StockMovements.AsNoTracking()
                    .Where(m => m.CompanyId == companyId).ToListAsync())
                .GroupBy(m => m.ItemTypeId).ToDictionary(g => g.Key, g => g.ToList());
            var ids = openings.Keys.Union(byItem.Keys).Distinct().ToList();
            var names = await _context.ItemTypes.AsNoTracking()
                .Where(i => ids.Contains(i.Id)).Select(i => new { i.Id, i.Name, i.HSCode })
                .ToDictionaryAsync(i => i.Id);

            // FIFO books are built directly: the compare is asked BEFORE the
            // company is switched, when LoadAsync would answer weighted average.
            var fifo = await StockCosting.LoadForCompareAsync(_context, companyId, ids);
            var items = new List<object>();
            decimal waValue = 0m, fifoValue = 0m, waOut = 0m, fifoOut = 0m, waActual = 0m, fifoActual = 0m;
            foreach (var id in ids)
            {
                var open = openings.GetValueOrDefault(id);
                var moves = byItem.GetValueOrDefault(id) ?? new List<StockMovement>();
                var wa = StockValuation.Compute(open?.Qty ?? 0m, open?.Value ?? 0m, open?.ActualCost ?? 0m,
                    open?.Rate ?? 0m, moves);
                var fr = fifo.Detailed(id, open?.Qty ?? 0m, open?.Value ?? 0m, open?.ActualCost ?? 0m,
                    open?.Rate ?? 0m, moves);
                var f = fr.Position;
                waValue += wa.ValueExcludingTax; fifoValue += f.ValueExcludingTax;
                waOut += wa.ValueOut; fifoOut += f.ValueOut;
                waActual += wa.ActualValueExcludingTax; fifoActual += f.ActualValueExcludingTax;
                if (wa.Quantity != f.Quantity || wa.ValueExcludingTax != f.ValueExcludingTax
                    || wa.ActualValueExcludingTax != f.ActualValueExcludingTax)
                {
                    names.TryGetValue(id, out var n);
                    items.Add(new
                    {
                        itemTypeId = id, itemTypeName = n?.Name, hsCode = n?.HSCode,
                        quantity = wa.Quantity, fifoQuantity = f.Quantity,
                        weightedAverageValue = wa.ValueExcludingTax, fifoValue = f.ValueExcludingTax,
                        weightedAverageActual = wa.ActualValueExcludingTax, fifoActual = f.ActualValueExcludingTax,
                        weightedAverageValueOut = wa.ValueOut, fifoValueOut = f.ValueOut,
                        gdPools = fr.Pools.Count(p => p.GdNumber != null),
                        shortfallQuantity = fr.ShortfallQuantity,
                    });
                }
            }
            return Ok(new
            {
                companyId,
                method = await StockCostingMethod.GetAsync(_context, companyId),
                itemCount = ids.Count,
                changedItemCount = items.Count,
                weightedAverageValue = Money(waValue), fifoValue = Money(fifoValue),
                weightedAverageValueOut = Money(waOut), fifoValueOut = Money(fifoOut),
                weightedAverageActual = Money(waActual), fifoActual = Money(fifoActual),
                items,
            });
        }

        public record SetCostingMethodRequest(string Method);

        /// <summary>
        /// Switch how this company values stock. Reversible: both methods are
        /// derived from the same movements, so nothing stored changes -- except
        /// the monthly cost-of-goods relief, which is re-posted on the new basis
        /// (the same rebuild an opening-stock import runs).
        /// </summary>
        [HttpPut("company/{companyId}/costing-method")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetCostingMethod(int companyId, [FromBody] SetCostingMethodRequest req)
        {
            var method = req?.Method switch
            {
                var m when string.Equals(m, StockCostingMethod.GdFifo, StringComparison.OrdinalIgnoreCase)
                    => StockCostingMethod.GdFifo,
                var m when string.Equals(m, StockCostingMethod.WeightedAverage, StringComparison.OrdinalIgnoreCase)
                    => StockCostingMethod.WeightedAverage,
                _ => null,
            };
            if (method == null)
                return BadRequest(new { error = "Method must be WeightedAverage or GdFifo." });
            if (!await _context.Companies.AnyAsync(c => c.Id == companyId)) return NotFound();

            var previous = await StockCostingMethod.GetAsync(_context, companyId);
            if (previous == method) return Ok(new { companyId, method, changed = false });

            // FIFO BY GD IS ONE-WAY (maintainer's decision, 2026-09-28). A company
            // holding stock on FIFO never goes back to the weighted average: its
            // GD attribution, restatements and posted cost of goods are built on
            // FIFO. Only a company that has never held stock -- no opening, no
            // movement, so nothing to re-value -- may still choose the average.
            if (previous == StockCostingMethod.GdFifo && method == StockCostingMethod.WeightedAverage
                && (await _context.OpeningStockBalances.AnyAsync(o => o.CompanyId == companyId)
                    || await _context.StockMovements.AnyAsync(m => m.CompanyId == companyId)))
                return BadRequest(new
                {
                    error = "This company values stock FIFO by GD and cannot be moved back to the weighted average."
                });

            await StockCostingMethod.SetAsync(_context, companyId, method, CurrentUserId);

            // Cost of goods sold already posted was worked out on the old
            // basis; re-post it on the new one so the ledger keeps agreeing with
            // the stock screen. Respects the GL lock date like every rebuild.
            await _posting.PostInventoryPeriodsAsync(companyId, null);

            await _audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = User.Identity?.Name,
                HttpMethod = "PUT",
                RequestPath = $"/api/stock/company/{companyId}/costing-method",
                StatusCode = 200,
                ExceptionType = "STOCK_COSTING_METHOD_CHANGE",
                Message = $"Stock costing method changed {previous} → {method} for company {companyId}",
                CompanyId = companyId,
            });
            return Ok(new { companyId, method, changed = true, previous });
        }

        /// <summary>
        /// Restate items to a stock sheet's GD lines under FIFO by GD (CLAUDE.md
        /// 5b-17): from today each listed item holds exactly those lines, so its
        /// value and every GD's balance equal the sheet. Quantity never moves --
        /// an item whose sheet quantity is not its on-hand is refused. Preview
        /// unless <c>Commit</c>; a commit writes one value-only movement per item
        /// (which also lands the weighted average on the sheet's value), its
        /// lines, re-posts the month's COGS relief, and is audited.
        /// </summary>
        [HttpPost("company/{companyId}/fifo-restatement")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<FifoRestatementResultDto>> RestateFifo(
            int companyId, [FromBody] FifoRestatementRequestDto req)
        {
            if (req?.Lines == null || req.Lines.Count == 0)
                return BadRequest(new { error = "Send the sheet's lines." });
            if (!await StockCostingMethod.IsGdFifoAsync(_context, companyId))
                return BadRequest(new { error = "Restating to GD lines needs the company on FIFO by GD." });
            // A division-restricted caller sees part of the movements; a
            // restatement must be measured against the whole company's stock.
            if (await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId) != null)
                return StatusCode(403, new { error = "Restating stock needs access to every division." });
            foreach (var l in req.Lines)
            {
                if (string.IsNullOrWhiteSpace(l.GdNumber) || l.GdNumber.Trim().Length > 100)
                    return BadRequest(new { error = $"Row {l.SourceRow}: a GD number is required." });
                if (l.Quantity <= 0m || l.ValueExcludingTax < 0m || l.SalesTaxRate < 0m || l.SalesTaxRate >= 100m)
                    return BadRequest(new { error = $"Row {l.SourceRow}: quantity must be above zero, value not negative, rate 0 to under 100." });
                if (l.ClaimMonth is { } cm && (cm.Day != 1 || cm.TimeOfDay != TimeSpan.Zero))
                    return BadRequest(new { error = $"Row {l.SourceRow}: claim month must be the first day of the month." });
            }

            var openings = await _context.OpeningStockBalances.AsNoTracking()
                .Where(o => o.CompanyId == companyId)
                .GroupBy(o => o.ItemTypeId)
                .Select(g => new
                {
                    ItemTypeId = g.Key, Qty = g.Sum(o => o.Quantity), Value = g.Sum(o => o.ValueExcludingTax),
                    ActualCost = g.Sum(o => o.ActualCostExcludingTax), Rate = g.Max(o => o.SalesTaxRate),
                }).ToDictionaryAsync(x => x.ItemTypeId);
            var moves = (await _context.StockMovements.AsNoTracking()
                    .Where(m => m.CompanyId == companyId).ToListAsync())
                .GroupBy(m => m.ItemTypeId).ToDictionary(g => g.Key, g => g.ToList());
            var held = openings.Keys.Union(moves.Keys).Distinct().ToList();
            var names = await _context.ItemTypes.AsNoTracking().Where(i => held.Contains(i.Id))
                .Select(i => new { i.Id, i.Name, i.HSCode }).ToDictionaryAsync(i => i.Id);
            var costing = await StockCosting.LoadAsync(_context, companyId, held);

            var result = new FifoRestatementResultDto();
            var plans = new List<(FifoRestatementItemDto Item, List<FifoRestatementLineDto> Lines, decimal WaValue)>();
            foreach (var g in req.Lines.GroupBy(l => l.ItemTypeId))
            {
                var id = g.Key;
                var item = new FifoRestatementItemDto
                {
                    ItemTypeId = id, LineCount = g.Count(),
                    SheetQuantity = g.Sum(l => l.Quantity),
                    SheetValue = Money(g.Sum(l => l.ValueExcludingTax)),
                };
                if (!names.TryGetValue(id, out var n))
                {
                    item.Error = "This company holds no stock record for that item.";
                    result.Items.Add(item);
                    continue;
                }
                item.ItemTypeName = n.Name; item.HsCode = n.HSCode;
                var o = openings.GetValueOrDefault(id);
                var ms = moves.GetValueOrDefault(id) ?? new List<StockMovement>();
                var wa = StockValuation.Compute(o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                var fifo = costing.Compute(id, o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                item.OnHand = fifo.Quantity;
                item.FifoValue = fifo.ValueExcludingTax;
                item.WeightedAverageValue = wa.ValueExcludingTax;
                item.LandedValue = wa.ActualValueExcludingTax;
                if (Math.Abs(item.SheetQuantity - item.OnHand) > 0.0001m)
                    item.Error = $"The sheet has {item.SheetQuantity:0.####} but {item.OnHand:0.####} is on hand. " +
                                 "Correct the quantity first (a stock adjustment); a restatement never moves quantity.";
                result.Items.Add(item);
                plans.Add((item, g.OrderBy(l => l.SourceRow).ToList(), wa.ValueExcludingTax));
            }
            var listed = req.Lines.Select(l => l.ItemTypeId).ToHashSet();
            foreach (var id in held.Where(i => !listed.Contains(i)))
            {
                var o = openings.GetValueOrDefault(id);
                var ms = moves.GetValueOrDefault(id) ?? new List<StockMovement>();
                var p = costing.Compute(id, o?.Qty ?? 0m, o?.Value ?? 0m, o?.ActualCost ?? 0m, o?.Rate ?? 0m, ms);
                if (Math.Abs(p.Quantity) <= 0.0001m && Math.Abs(p.ValueExcludingTax) <= 0.005m) continue;
                result.NotInSheet.Add(new FifoRestatementItemDto
                {
                    ItemTypeId = id, ItemTypeName = names.GetValueOrDefault(id)?.Name ?? "",
                    HsCode = names.GetValueOrDefault(id)?.HSCode, OnHand = p.Quantity, FifoValue = p.ValueExcludingTax,
                });
            }
            result.FifoValueBefore = Money(result.Items.Sum(i => i.FifoValue) + result.NotInSheet.Sum(i => i.FifoValue));
            result.SheetValue = Money(result.Items.Sum(i => i.SheetValue));
            result.CanCommit = result.Items.Count > 0 && result.Items.All(i => i.Error == null);
            if (!req.Commit || !result.CanCommit) return Ok(result);

            var today = PakistanClock.Today;
            var file = string.IsNullOrWhiteSpace(req.SourceFile) ? null
                : Path.GetFileName(req.SourceFile.Trim()) is var f && f.Length > 260 ? f[..260] : Path.GetFileName(req.SourceFile.Trim());
            await using (var tx = await _context.Database.BeginTransactionAsync())
            {
                foreach (var (item, lines, waValue) in plans)
                {
                    // The same movement lands the weighted average on the sheet's
                    // total, so switching method back keeps the sheet's figure.
                    var movement = new StockMovement
                    {
                        CompanyId = companyId, ItemTypeId = item.ItemTypeId,
                        Direction = StockMovementDirection.In, Quantity = 0m,
                        SourceType = StockMovementSourceType.Revaluation, MovementDate = today,
                        ValueAdjustmentExcludingTax = Money(item.SheetValue - waValue) is var d && d != 0m ? d : null,
                        Notes = $"FIFO restatement to stock sheet{(file != null ? $" {file}" : "")}: {lines.Count} GD lines",
                    };
                    _context.StockMovements.Add(movement);
                    await _context.SaveChangesAsync();

                    // The item's landed value at the restatement, spread over its
                    // lines by value -- the sheet's own cost columns are formulas.
                    var basis = lines.Sum(l => l.ValueExcludingTax);
                    decimal given = 0m;
                    for (var i = 0; i < lines.Count; i++)
                    {
                        var l = lines[i];
                        var actual = i == lines.Count - 1 ? Money(item.LandedValue) - given
                            : basis > 0m ? Money(item.LandedValue * l.ValueExcludingTax / basis) : 0m;
                        given += actual;
                        _context.StockRestatementLines.Add(new StockRestatementLine
                        {
                            CompanyId = companyId, ItemTypeId = item.ItemTypeId, StockMovementId = movement.Id,
                            GdNumber = l.GdNumber.Trim(), GdDate = l.GdDate?.Date, ClaimMonth = l.ClaimMonth,
                            SourceRow = l.SourceRow, Description = l.Description?.Trim() is { Length: > 300 } s ? s[..300] : l.Description?.Trim(),
                            Quantity = l.Quantity, ValueExcludingTax = Money(l.ValueExcludingTax),
                            ActualValueExcludingTax = actual, SalesTaxRate = l.SalesTaxRate, SourceFile = file,
                        });
                    }
                    await _context.SaveChangesAsync();
                }
                await tx.CommitAsync();
            }

            // The value change is an adjustment in this month's relief.
            await _posting.PostInventoryPeriodsAsync(companyId, today);
            await _audit.LogAsync(new AuditLog
            {
                Timestamp = DateTime.UtcNow,
                Level = "Information",
                UserName = User.Identity?.Name,
                HttpMethod = "POST",
                RequestPath = $"/api/stock/company/{companyId}/fifo-restatement",
                StatusCode = 200,
                ExceptionType = "STOCK_FIFO_RESTATEMENT",
                Message = $"FIFO restatement for company {companyId}: {plans.Count} items, {req.Lines.Count} GD lines, " +
                          $"value {result.FifoValueBefore:0.00} -> sheet {result.SheetValue:0.00}{(file != null ? $" from {file}" : "")}",
                CompanyId = companyId,
            });
            result.Committed = true;
            return Ok(result);
        }

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

            // V2 IS ONE-WAY (2026-09-08). Under V2 every item type is inventory,
            // so a company accumulates stock positions on items V1 does not track
            // at all. Going back would not untrack them -- it would leave their
            // movements recorded and their on-hand invisible, which reads as
            // stock vanishing. There is no safe automatic reverse, so the answer
            // is not to offer one; a genuine mistake is a support job with the
            // data in front of you, not a toggle.
            if (previous >= (byte)InventoryFlowVersion.V2Standard && req.Version < previous)
                return BadRequest(new
                {
                    error = "This company is on V2 inventory and cannot be moved back to V1. " +
                            "Under V2 every item type is stock-tracked, so returning to V1 would hide " +
                            "positions that still exist rather than removing them."
                });
            if (previous == req.Version)
                return Ok(new { companyId, inventoryFlowVersion = previous, changed = false });

            company.InventoryFlowVersion = req.Version;
            // StockGuardHardBlock is NEVER touched here. The hard oversell block
            // is opt-in: it may only ever be turned on by the operator ticking it
            // on the company form and saving. Changing the inventory tracking
            // version must not silently start blocking a company's billing —
            // that is exactly what stranded ABBAS ALI & SONS (a V2 switch had
            // auto-enabled the block, so every bill for a zero-stock item 409'd).
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
        /// <summary>
        /// The item types this company actually tracks stock for -- ids only.
        ///
        /// The stock modals need it because "which items can hold a stock
        /// position" is a SERVER rule (StockService.GetStockTrackedItemTypeIdsAsync):
        /// V1 tracks HS-coded item types, V2 tracks all of them, and a per-company
        /// CompanyItemTypeSetting overrides either. The dashboard used to guess,
        /// and its guess and its own on-screen hint had already drifted apart --
        /// the hint promised HS-less items were hidden while both pickers offered
        /// all 335 of them. Ask the rule instead of restating it.
        ///
        /// Read-only, so it rides the dashboard permission rather than the
        /// policy-management one.
        /// </summary>
        [HttpGet("company/{companyId}/tracked-itemtypes")]
        [HasPermission("stock.dashboard.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<int>>> GetTrackedItemTypes(int companyId)
        {
            var allIds = await _context.ItemTypes
                .Where(it => !it.IsDeleted)
                .Select(it => it.Id)
                .ToListAsync();
            var tracked = await _stock.GetStockTrackedItemTypeIdsAsync(companyId, allIds);
            return Ok(tracked.OrderBy(i => i).ToList());
        }

        [HttpPost("company/{companyId}/itemtype-policy")]
        [HasPermission("stock.policy.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetItemTypePolicy(int companyId, [FromBody] SetItemTypePolicyRequest req)
        {
            if (req == null || req.ItemTypeId <= 0)
                return BadRequest(new { error = "itemTypeId is required." });
            if (req.Mode > 2)
                return BadRequest(new { error = "mode must be 0 (default), 1 (tracked) or 2 (FBR-only)." });
            // Company-level policy: a division-restricted user may not write it,
            // and the item must be one this company may already see -- a policy
            // row would otherwise register another tenant's item here.
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, null);
            if (!await ItemTypeMembership.IsVisibleAsync(_context, req.ItemTypeId, new[] { companyId }))
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
