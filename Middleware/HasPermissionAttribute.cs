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

    /// <summary>
    /// OR-variant guard: <c>[HasAnyPermission("bills.list.view", "invoices.list.view")]</c>.
    /// Passes if the user has ANY of the listed permissions.
    /// Use when an endpoint serves two permission audiences with the same
    /// data shape — e.g. the Invoices listing endpoint backs both the Bills
    /// page and the Invoices page; granting either should be enough to
    /// fetch the list. Stack this attribute INSTEAD of [HasPermission] —
    /// stacking [HasPermission("a")] + [HasPermission("b")] is AND, which
    /// is the opposite of what's needed here.
    /// 2026-05-09: pre-fix, users with only invoices.list.view saw the
    /// Invoices sidebar entry but got 403 from the list API because it
    /// required bills.list.view.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
    public class HasAnyPermissionAttribute : TypeFilterAttribute
    {
        public HasAnyPermissionAttribute(params string[] permissionKeys) : base(typeof(HasAnyPermissionFilter))
        {
            Arguments = new object[] { permissionKeys };
        }
    }

    internal class HasAnyPermissionFilter : IAsyncAuthorizationFilter
    {
        private readonly string[] _permissionKeys;
        private readonly IPermissionService _permissions;

        public HasAnyPermissionFilter(string[] permissionKeys, IPermissionService permissions)
        {
            _permissionKeys = permissionKeys;
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

            var sub = user.FindFirstValue(JwtRegisteredClaimNames.Sub)
                      ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!int.TryParse(sub, out var userId))
            {
                context.Result = new ForbidResult();
                return;
            }

            foreach (var key in _permissionKeys)
            {
                if (await _permissions.HasPermissionAsync(userId, key))
                    return; // first match wins
            }

            context.Result = new ObjectResult(new
            {
                message = $"Permission denied: requires any of [{string.Join(", ", _permissionKeys)}]."
            })
            {
                StatusCode = StatusCodes.Status403Forbidden
            };
        }
    }
}
