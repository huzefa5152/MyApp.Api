using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Restricts an action to the seed admin (AppSettings:SeedAdminUserId).
    ///
    /// For writes to INSTALLATION-WIDE tables — rows with no CompanyId that
    /// every tenant reads (FBR lookup codes, template merge fields). A
    /// permission key is not enough there: keys are granted to tenant
    /// Administrators, and one tenant's edit would change every other
    /// tenant's FBR filings or print templates. Use alongside [HasPermission],
    /// which still documents what the action is.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
    public sealed class SeedAdminOnlyAttribute : TypeFilterAttribute
    {
        public SeedAdminOnlyAttribute() : base(typeof(SeedAdminOnlyFilter)) { }
    }

    internal sealed class SeedAdminOnlyFilter(IManagementScopeService scope) : IAsyncAuthorizationFilter
    {
        public Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var user = context.HttpContext.User;
            if (user?.Identity?.IsAuthenticated != true)
            {
                context.Result = new UnauthorizedResult();
                return Task.CompletedTask;
            }
            var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!int.TryParse(sub, out var userId) || !scope.IsSeedAdmin(userId))
            {
                context.Result = new ObjectResult(new
                {
                    message = "These settings are shared by every company, so only the system administrator can change them."
                })
                { StatusCode = StatusCodes.Status403Forbidden };
            }
            return Task.CompletedTask;
        }
    }
}
