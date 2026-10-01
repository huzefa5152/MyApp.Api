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
public class DocumentNumbersController(AppDbContext db, IPermissionService permissions) : ControllerBase
{
    [HttpGet("{kind}")]
    [AuthorizeCompany]
    [HasAnyPermission("salesquotes.manage.create", "challans.manage.create", "purchasebills.manage.create", "goodsreceipts.manage.create")]
    public async Task<IActionResult> Get(int companyId, string kind, [FromQuery] int? check)
    {
        var permission = CompanyDocumentNumbers.Permission(kind);
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            || !await permissions.HasPermissionAsync(userId, permission)) return Forbid();
        return Ok(await CompanyDocumentNumbers.PreviewAsync(db, companyId, kind, check));
    }
}
