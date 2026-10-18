using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Models;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;
namespace MyApp.Api.Controllers;

[Authorize, ApiController, Route("api/stockentries")]
public class StockEntriesController(AppDbContext db, ICompanyAccessGuard access, IPermissionService permissions, StockEntryService service, IStockService stock) : ControllerBase
{
    private int UserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : 0;
    [HttpGet("company/{companyId}")]
    [HasAnyPermission("stock.opening.manage", "stock.adjust.create")]
    public async Task<IActionResult> List(int companyId, int page = 1, string? kind = null, string? status = null, string? search = null)
    {
        await access.AssertAccessAsync(UserId, companyId);
        var canOpen = await permissions.HasPermissionAsync(UserId, "stock.opening.manage");
        var canAdjust = await permissions.HasPermissionAsync(UserId, "stock.adjust.create");
        var query = db.StockEntries.AsNoTracking().Where(e => e.CompanyId == companyId &&
            (e.Kind == "Opening" && canOpen || e.Kind == "Adjustment" && canAdjust));
        if (!string.IsNullOrEmpty(kind))
        {
            if (kind != "Opening" && kind != "Adjustment") return BadRequest(new { error = "Choose a valid entry type." });
            query = query.Where(e => e.Kind == kind);
        }
        if (!string.IsNullOrEmpty(status))
        {
            if (status != "active" && status != "reversed") return BadRequest(new { error = "Choose a valid entry status." });
            query = query.Where(e => e.IsCancelled == (status == "reversed"));
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            if (term.Length > 100) return BadRequest(new { error = "Search is too long." });
            query = query.Where(e => e.ItemType.Name.Contains(term) || e.Reason.Contains(term));
        }
        return Ok(await query.OrderByDescending(e => e.Id)
            .Skip((PaginationHelper.ClampPage(page) - 1) * 20).Take(20)
            .Select(e => new { e.Id, e.Kind, e.Date, e.ItemTypeId, ItemName = e.ItemType.Name, Uom = e.ItemType.UOM, e.QuantityDelta, e.UnitCost, e.Reason, e.IsCancelled }).ToListAsync());
    }
    [HttpGet("company/{companyId}/items")]
    [HasAnyPermission("stock.opening.manage", "stock.adjust.create")]
    public async Task<IActionResult> Items(int companyId, DateTime? asOf = null)
    {
        await access.AssertAccessAsync(UserId, companyId);
        var items = await db.ItemTypes.AsNoTracking().Where(i => i.CompanyId == companyId && !i.IsDeleted && i.HSCode != null && i.HSCode.Trim() != "")
            .OrderBy(i => i.Name).Select(i => new { i.Id, i.Name, i.HSCode, i.UOM }).ToListAsync();
        var quantities = await stock.GetOnHandBulkAsync(companyId, items.Select(i => i.Id));
        var costs = await InventoryCostBasis.LoadAsync(db, companyId, items.Select(i => i.Id).ToList());
        return Ok(new { TrackingEnabled = await stock.IsTrackingEnabledAsync(companyId), Items = items.Select(i => new {
            i.Id, i.Name, i.HSCode, i.UOM, CurrentQuantity = quantities.GetValueOrDefault(i.Id),
            UnitCost = InventoryCostBasis.Average(costs.Where(r => r.ItemTypeId == i.Id && r.Date <= (asOf ?? PakistanClock.Today).Date)) }) });
    }
    [HttpPost]
    [HasAnyPermission("stock.opening.manage", "stock.adjust.create")]
    public async Task<IActionResult> Create(CreateStockEntryDto dto)
    {
        await access.AssertAccessAsync(UserId, dto.CompanyId);
        if (!await permissions.HasPermissionAsync(UserId, dto.Kind == "Opening" ? "stock.opening.manage" : "stock.adjust.create")) return Forbid();
        try { var entry = await service.CreateAsync(dto); return Ok(new { entry.Id, entry.Kind, entry.QuantityDelta, entry.UnitCost, entry.IsCancelled }); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }
    [HttpPost("{id}/cancel")]
    [HasAnyPermission("stock.opening.manage", "stock.adjust.create")]
    public async Task<IActionResult> Cancel(int id)
    {
        var entry = await db.StockEntries.AsNoTracking().Where(e => e.Id == id).Select(e => new { e.CompanyId, e.Kind }).FirstOrDefaultAsync();
        if (entry == null) return NotFound();
        await access.AssertAccessAsync(UserId, entry.CompanyId);
        if (!await permissions.HasPermissionAsync(UserId, entry.Kind == "Opening" ? "stock.opening.manage" : "stock.adjust.create")) return Forbid();
        try { await service.CancelAsync(entry.CompanyId, id); return Ok(new { message = "Stock entry reversed." }); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }
}
