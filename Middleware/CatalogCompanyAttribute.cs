using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware;

// Catalog lookups are per company, including mutations addressed by row id.
public sealed class CatalogCompanyAttribute : TypeFilterAttribute
{
    public CatalogCompanyAttribute() : base(typeof(CatalogCompanyFilter)) { }
}
public sealed class CatalogCompanyFilter(AppDbContext db, ICompanyAccessGuard access) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var userId = int.Parse(context.HttpContext.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? context.HttpContext.User.FindFirstValue("sub") ?? "0");
        int? companyId = null;
        var supplied = request.Query["companyId"].FirstOrDefault() ?? request.Headers["X-Company-Id"].FirstOrDefault();
        if (!string.IsNullOrEmpty(supplied))
        {
            if (!int.TryParse(supplied, out var parsed) || parsed <= 0)
            { context.Result = new BadRequestObjectResult(new { message = "Invalid company." }); return; }
            companyId = parsed;
        }
        if (companyId == null)
            foreach (var arg in context.ActionArguments.Values)
                if (arg?.GetType().GetProperty("CompanyId")?.GetValue(arg) is int bodyCompany)
                    companyId = bodyCompany;
        if (context.ActionArguments.TryGetValue("id", out var idValue) && idValue is int id)
        {
            int? owner = request.Path.StartsWithSegments("/api/itemtypes")
                ? await db.ItemTypes.IgnoreQueryFilters().Where(x=>x.Id==id).Select(x=>x.CompanyId).FirstOrDefaultAsync()
                : request.Path.StartsWithSegments("/api/units")
                    ? await db.Units.IgnoreQueryFilters().Where(x=>x.Id==id).Select(x=>x.CompanyId).FirstOrDefaultAsync()
                    : await db.ItemDescriptions.IgnoreQueryFilters().Where(x=>x.Id==id).Select(x=>x.CompanyId).FirstOrDefaultAsync();
            if (owner == null || (companyId != null && companyId != owner)
                || !await access.HasAccessAsync(userId, owner.Value))
            { context.Result = new NotFoundResult(); return; }
            companyId = owner;
        }
        if (companyId == null)
        {
            var allowed = await access.GetAccessibleCompanyIdsAsync(userId);
            if (allowed.Count == 1) companyId = allowed.Single();
        }
        if (companyId == null)
        { context.Result = new BadRequestObjectResult(new { message = "Choose a company before using its catalog." }); return; }
        await access.AssertAccessAsync(userId, companyId.Value);
        // Services that use the optional company argument for FBR enrichment
        // must use the same company that owns the catalog.
        if (context.ActionArguments.ContainsKey("companyId")) context.ActionArguments["companyId"] = companyId.Value;
        await next();
    }
}
