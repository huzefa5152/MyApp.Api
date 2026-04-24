using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Declarative endpoint guard: <c>[HasPermission("users.manage.create")]</c>.
    /// Returns 401 if the request is unauthenticated, 403 if the authenticated
    /// user lacks the required permission. Seed admin bypasses.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
    public class HasPermissionAttribute : TypeFilterAttribute
    {
        public HasPermissionAttribute(string permissionKey) : base(typeof(HasPermissionFilter))
        {
            Arguments = new object[] { permissionKey };
        }
    }

    internal class HasPermissionFilter : IAsyncAuthorizationFilter
    {
        private readonly string _permissionKey;
        private readonly IPermissionService _permissions;

        public HasPermissionFilter(string permissionKey, IPermissionService permissions)
        {
            _permissionKey = permissionKey;
            _permissions = permissions;
        }

        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var user = context.HttpContext.User;
            if (user?.Identity?.IsAuthenticated != true)
            {
                context.Result = new UnauthorizedResult();
                return;
            }

            // JWT tokens in this app carry the user id in the "sub" claim.
            var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub)
                      ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!int.TryParse(sub, out var userId))
            {
                context.Result = new ForbidResult();
                return;
            }

            if (!await _permissions.HasPermissionAsync(userId, _permissionKey))
            {
                context.Result = new ObjectResult(new
                {
                    message = $"Permission denied: requires '{_permissionKey}'."
                })
                {
                    StatusCode = StatusCodes.Status403Forbidden
                };
            }
        }
    }
}
