using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Middleware
{
    /// <summary>
    /// Resolves the <c>{token}</c> route value into a <see cref="ResolvedPortal"/>
    /// before any public portal action runs, and refuses the request when it does
    /// not resolve.
    ///
    /// A filter rather than a line at the top of each action, for the same reason
    /// <see cref="AuthorizeCompanyAttribute"/> exists: the check must be
    /// impossible to forget on the one endpoint somebody adds later. Actions read
    /// the result via <see cref="Portal"/>.
    ///
    /// Every failure — unknown token, disabled portal, revoked portal, malformed
    /// token — returns the SAME 404 and the same body. GlobalExceptionMiddleware
    /// echoes 4xx messages verbatim, so distinct wording would tell a stranger
    /// which of their guesses had been a real portal once.
    /// </summary>
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, Inherited = true)]
    public class ResolvePortalAttribute : TypeFilterAttribute
    {
        public ResolvePortalAttribute() : base(typeof(ResolvePortalFilter)) { }

        /// <summary>Key under which the resolved portal is stashed.</summary>
        public const string ItemsKey = "resolvedCustomerPortal";
    }

    internal class ResolvePortalFilter : IAsyncAuthorizationFilter
    {
        private readonly ICustomerPortalService _portals;

        public ResolvePortalFilter(ICustomerPortalService portals) => _portals = portals;

        public async Task OnAuthorizationAsync(AuthorizationFilterContext context)
        {
            var token = context.RouteData.Values["token"] as string;
            var portal = string.IsNullOrEmpty(token) ? null : await _portals.ResolveAsync(token);

            if (portal == null)
            {
                context.Result = new NotFoundObjectResult(new
                {
                    message = "This customer portal is no longer available.",
                    statusCode = StatusCodes.Status404NotFound,
                });
                return;
            }

            context.HttpContext.Items[ResolvePortalAttribute.ItemsKey] = portal;
            // GlobalExceptionMiddleware derives the tenant for an audit row from a
            // route {companyId}, a ?companyId=, or this key. A token-only route
            // matches neither of the first two, so without this the entire public
            // surface would be untenanted in the audit trail.
            context.HttpContext.Items["currentCompanyId"] = portal.CompanyId;
        }
    }
}
