using System.Security.Claims;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware;

// Query filters need a trusted readable set even when a document-id endpoint
// loads its parent before asserting that parent's company.
public sealed class CatalogAccessMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ICompanyAccessGuard access)
    {
        if (int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? context.User.FindFirstValue("sub"), out var userId))
            context.Items["catalogAllowedIds"] = (await access.GetAccessibleCompanyIdsAsync(userId)).ToArray();
        await next(context);
    }
}
