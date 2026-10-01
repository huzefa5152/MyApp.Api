using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware;

// A public static provider must never be the authorization boundary for uploads.
public sealed class PrivateDataFilesMiddleware(RequestDelegate next)
{
    public const string CookieName = "trader-image-session";

    public static bool IsImagePath(PathString path) =>
        path.StartsWithSegments("/data/uploads/logos", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/data/uploads/stamps", StringComparison.OrdinalIgnoreCase)
        || path.StartsWithSegments("/data/images/avatars", StringComparison.OrdinalIgnoreCase);

    public async Task InvokeAsync(HttpContext context, AppDbContext db,
        ICompanyAccessGuard access, IManagementScopeService management)
    {
        var path = context.Request.Path;
        if (!path.StartsWithSegments("/data", StringComparison.OrdinalIgnoreCase))
        { await next(context); return; }
        // Deny unknown directories, orphaned uploads, backups and key material.
        if (!IsImagePath(path) || !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
        { context.Response.StatusCode = 404; return; }
        context.Response.Headers.CacheControl = "no-store, private";
        context.Response.Headers.Vary = "Cookie, Authorization";
        if (context.User.Identity?.IsAuthenticated != true
            || !int.TryParse(context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? context.User.FindFirstValue("sub"), out var userId)
            || userId <= 0)
        { context.Response.StatusCode = 401; return; }
        var value = path.Value!;
        int? companyId = null;
        if (path.StartsWithSegments("/data/uploads/logos", StringComparison.OrdinalIgnoreCase))
            companyId = await db.Companies.AsNoTracking().Where(c => c.LogoPath == value).Select(c => (int?)c.Id).FirstOrDefaultAsync();
        else if (path.StartsWithSegments("/data/uploads/stamps", StringComparison.OrdinalIgnoreCase))
            companyId = await db.CompanyStamps.AsNoTracking().Where(s => s.FilePath == value).Select(s => (int?)s.CompanyId).FirstOrDefaultAsync();
        else
        {
            var owner = await db.Users.AsNoTracking().Where(u => u.AvatarPath == value).Select(u => (int?)u.Id).FirstOrDefaultAsync();
            if (owner.HasValue && (owner == userId || await management.CanManageUserAsync(userId, owner.Value)))
            { await next(context); return; }
            context.Response.StatusCode = 404; return;
        }
        if (!companyId.HasValue || !await access.HasAccessAsync(userId, companyId.Value))
        { context.Response.StatusCode = 404; return; }
        await next(context);
    }
}
