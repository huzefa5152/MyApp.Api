using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/companies/{companyId:int}/document-numbers")]
public class DocumentNumbersController(AppDbContext db, IPermissionService permissions) : ControllerBase
{
    [HttpGet("{kind}")]
    [AuthorizeCompany]
    [HasAnyPermission("salesquotes.manage.create", "challans.manage.create", "purchasebills.manage.create", "goodsreceipts.manage.create", "salesquotes.manage.update", "challans.manage.update", "purchasebills.manage.update", "goodsreceipts.manage.update")]
    public async Task<IActionResult> Get(int companyId, string kind, [FromQuery] int? check, [FromQuery] int? excludeId, [FromQuery] int? clientId)
    {
        var permission = CompanyDocumentNumbers.Permission(kind, excludeId.HasValue);
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            || !await permissions.HasPermissionAsync(userId, permission)) return Forbid();
        if (excludeId.HasValue && !await CompanyDocumentNumbers.ExistsAsync(db, companyId, kind, excludeId.Value)) return NotFound();
        if (kind == "challan" && clientId.HasValue && !await db.Clients.AnyAsync(c => c.Id == clientId && c.CompanyId == companyId)) return NotFound();
        return Ok(await CompanyDocumentNumbers.PreviewAsync(db, companyId, kind, check, excludeId, clientId));
    }
}
