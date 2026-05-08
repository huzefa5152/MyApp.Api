using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Tenant-scope guard. Pulls a <c>companyId</c> from the route or
    /// query (parameter name configurable, defaults to <c>"companyId"</c>)
    /// and runs it through <see cref="ICompanyAccessGuard"/>. Returns 401
    /// if unauthenticated, 403 if the user lacks access to that company,
    /// 400 if the parameter is missing or malformed.
    ///
    /// For endpoints whose <c>companyId</c> lives on the request body
    /// (model binding completes after authorization filters), call
    /// <see cref="ICompanyAccessGuard.AssertAccessAsync"/> directly inside
    /// the action instead.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
    public class AuthorizeCompanyAttribute : TypeFilterAttribute
    {
        public AuthorizeCompanyAttribute(string parameterName = "companyId")
            : base(typeof(AuthorizeCompanyFilter))
        {
            Arguments = new object[] { parameterName };
        }
    }

    internal class AuthorizeCompanyFilter : IAsyncAuthorizationFilter
    {
        private readonly string _parameterName;
        private readonly ICompanyAccessGuard _guard;

        public AuthorizeCompanyFilter(string parameterName, ICompanyAccessGuard guard)
        {
            _parameterName = parameterName;
            _guard = guard;
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

            // Route values first, then query string — same order ASP.NET
            // model binders use for parameter resolution.
            string? raw = context.RouteData.Values.TryGetValue(_parameterName, out var routeVal)
                ? routeVal?.ToString()
                : context.HttpContext.Request.Query[_parameterName].FirstOrDefault();

            if (string.IsNullOrWhiteSpace(raw))
            {
                context.Result = new BadRequestObjectResult(new
                {
                    message = $"Missing required '{_parameterName}' parameter."
                });
                return;
            }
            if (!int.TryParse(raw, out var companyId))
            {
                context.Result = new BadRequestObjectResult(new
                {
                    message = $"Invalid '{_parameterName}' parameter."
                });
                return;
            }

            if (!await _guard.HasAccessAsync(userId, companyId))
            {
                context.Result = new ObjectResult(new
                {
                    message = $"Access denied: you are not authorized for company {companyId}."
                })
                {
                    StatusCode = StatusCodes.Status403Forbidden
                };
            }
        }
    }
}
