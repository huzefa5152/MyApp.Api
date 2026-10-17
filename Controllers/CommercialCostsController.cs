using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

[Authorize]
[ApiController]
[Route("api/commercial-costs")]
public class CommercialCostsController(CommercialCostService costs, SupplierPayablesService payables,
    AppDbContext db, ICompanyAccessGuard access) : ControllerBase
{
    private int UserId => int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : 0;

    private async Task<bool> AssertDocument(string kind, int id)
    {
        if (kind != "bill" && kind != "challan") return false;
        var company = kind == "bill" ? await db.Invoices.Where(i => i.Id == id).Select(i => (int?)i.CompanyId).FirstOrDefaultAsync()
            : await db.DeliveryChallans.Where(i => i.Id == id).Select(i => (int?)i.CompanyId).FirstOrDefaultAsync();
        if (!company.HasValue) return false;
        await access.AssertAccessAsync(UserId, company.Value);
        return true;
    }

    [HttpGet("{kind}/{id:int}")]
    [HasPermission("bills.costs.view")]
    public async Task<IActionResult> Get(string kind, int id)
    {
        if (!await AssertDocument(kind, id)) return NotFound();
        var result = await costs.ReadAsync(kind, id);
        return result == null ? NotFound() : Ok(result);
    }

    [HttpPatch("{kind}/{id:int}")]
    [RequestSizeLimit(1048576)]
    [HasPermission("bills.costs.update")]
    public async Task<IActionResult> Save(string kind, int id, SaveCommercialCostsDto request)
    {
        if (!await AssertDocument(kind, id)) return NotFound();
        try { return Ok(await costs.SaveAsync(kind, id, request, UserId)); }
        catch (CommercialCostValidationException e) { return BadRequest(new { error = e.UserMessage }); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPost("{kind}/{id:int}/purchases")]
    [RequestSizeLimit(1048576)]
    [HasPermission("purchasebills.manage.create")]
    public async Task<IActionResult> CreatePurchases(string kind, int id, CreateLocalPurchasesDto request,
        [FromServices] IPermissionService permissions)
    {
        if (!await AssertDocument(kind, id)) return NotFound();
        if (!await permissions.HasPermissionAsync(UserId, "bills.costs.view")) return Forbid();
        try { return Ok(await costs.CreatePurchasesAsync(kind, id, request)); }
        catch (CommercialCostValidationException e) { return BadRequest(new { error = e.UserMessage }); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (DbUpdateException) { return Conflict(new { error = "A purchase was created concurrently. Reload the preview before trying again." }); }
    }

    [HttpGet("suppliers/{companyId:int}/{supplierId:int}")]
    [HasPermission("purchasebills.payables.view")]
    public async Task<IActionResult> Ledger(int companyId, int supplierId, DateTime? from = null, DateTime? asOf = null)
    {
        await access.AssertAccessAsync(UserId, companyId);
        var result = await payables.LedgerAsync(companyId, supplierId, from, asOf);
        return result == null ? NotFound() : Ok(result);
    }

    [HttpGet("bill/{id:int}/payables")]
    [HasPermission("purchasebills.payables.view")]
    public async Task<IActionResult> BillPayables(int id)
    {
        if (!await AssertDocument("bill", id)) return NotFound();
        var companyId = await db.Invoices.Where(i => i.Id == id).Select(i => i.CompanyId).SingleAsync();
        var deliveryIds = await db.InvoiceItems.Where(i => i.InvoiceId == id && i.DeliveryItemId.HasValue).Select(i => i.DeliveryItemId!.Value).ToListAsync();
        var challanIds = await db.DeliveryChallans.Where(c => c.InvoiceId == id).Select(c => c.Id).ToListAsync();
        var supplierIds = await db.PurchaseBills.AsNoTracking().Where(p => p.CompanyId == companyId &&
            (p.SourceInvoiceId == id || p.SourceDeliveryChallanId.HasValue && challanIds.Contains(p.SourceDeliveryChallanId.Value) ||
                p.Items.Any(i => i.LocalInvoiceItemId.HasValue && db.InvoiceItems.Any(x => x.Id == i.LocalInvoiceItemId && x.InvoiceId == id) ||
                    i.LocalDeliveryItemId.HasValue && deliveryIds.Contains(i.LocalDeliveryItemId.Value))))
            .Select(p => p.SupplierId).Distinct().ToListAsync();
        var result = new List<SupplierPurchaseBalanceDto>();
        foreach (var supplier in supplierIds)
        {
            var ledger = await payables.LedgerAsync(companyId, supplier, null, null);
            result.AddRange(ledger!.Purchases.Where(p => p.InvoiceIds.Contains(id)));
        }
        return Ok(result);
    }

    [HttpGet("suppliers/{companyId:int}")]
    [HasPermission("purchasebills.payables.view")]
    public async Task<IActionResult> Summary(int companyId, DateTime? asOf = null)
    {
        await access.AssertAccessAsync(UserId, companyId);
        return Ok(await payables.SummaryAsync(companyId, asOf));
    }
}
