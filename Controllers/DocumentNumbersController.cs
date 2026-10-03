using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Data;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/companies/{companyId:int}/document-numbers")]
public class DocumentNumbersController(AppDbContext db, IPermissionService permissions, IDivisionAccessGuard divisionAccess) : ControllerBase
{
    [HttpGet("{kind}")]
    [AuthorizeCompany]
    [HasAnyPermission("salesquotes.manage.create", "salesquotes.manage.update", "salesorders.manage.create", "salesorders.manage.update",
        "challans.manage.create", "challans.manage.update", "bills.manage.create", "bills.manage.create.standalone", "bills.manage.update",
        "purchasebills.manage.create", "purchasebills.manage.update", "goodsreceipts.manage.create", "goodsreceipts.manage.update", "invoices.note.create")]
    public async Task<IActionResult> Get(int companyId, string kind, [FromQuery] int? check, [FromQuery] int? excludeId, [FromQuery] int? divisionId)
    {
        if ((kind is "credit-note" or "debit-note") && excludeId.HasValue)
            return BadRequest(new { message = "Note numbers cannot be edited." });
        string permission;
        try { permission = CompanyDocumentNumbers.Permission(kind, excludeId.HasValue); }
        catch (InvalidOperationException) { return BadRequest(new { message = "Unknown document type." }); }
        if (!int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)) return Forbid();
        var allowed = await permissions.HasPermissionAsync(userId, permission);
        if (!allowed && kind == "invoice" && !excludeId.HasValue)
            allowed = await permissions.HasPermissionAsync(userId, "bills.manage.create.standalone");
        if (!allowed) return Forbid();
        if (excludeId.HasValue)
        {
            await divisionAccess.AssertAccessAsync(userId, companyId, divisionId);
            if (!await CompanyDocumentNumbers.ExistsAsync(db, companyId, kind, excludeId.Value)) return NotFound();
            var storedDivision = await CompanyDocumentNumbers.StoredDivisionAsync(db, companyId, kind, excludeId.Value);
            await divisionAccess.AssertAccessAsync(userId, companyId, storedDivision);
        }
        else await divisionAccess.AssertWriteAccessAsync(userId, companyId, divisionId);
        return Ok(await CompanyDocumentNumbers.PreviewAsync(db, companyId, kind, check, excludeId, divisionId));
    }
}
