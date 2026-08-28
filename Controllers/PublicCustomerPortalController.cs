using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The PUBLIC Customer Portal. Deliberately unauthenticated: the token in the
    /// route is the entire access control, and it is a 256-bit CSPRNG value.
    ///
    /// This is only the second anonymous controller in the codebase (the other is
    /// ProductImagesController), so the reasoning is written down here:
    ///
    ///  • Authorization in this app is opt-in per controller — there is no global
    ///    fallback policy — so [AllowAnonymous] is carried EXPLICITLY rather than
    ///    relying on the absence of [Authorize]. It makes the intent greppable and
    ///    survives someone adding a global policy later.
    ///  • [ResolvePortal] runs before every action and turns the token into a
    ///    company + client. Actions never accept a company, client or invoice id
    ///    from the caller, so there is no parameter to tamper with: the invoice
    ///    number in the route is resolved WITHIN the portal's scope, and a number
    ///    belonging to another client simply does not exist from here.
    ///  • Every failure returns the same 404 body, so the endpoint cannot be used
    ///    to confirm that a token was ever valid.
    ///  • The rate-limit policy partitions on the token rather than the IP,
    ///    because behind the MonsterASP proxy the remote IP is not reliably the
    ///    caller's (ForwardedHeaders:KnownProxies is still unset — audit C-12).
    /// </summary>
    [AllowAnonymous]
    [ApiController]
    [Route("api/public/customer-portal/{token}")]
    [ResolvePortal]
    [EnableRateLimiting("portal")]
    public class PublicCustomerPortalController : ControllerBase
    {
        private readonly ICustomerPortalService _service;
        private readonly int _defaultPageSize;

        public PublicCustomerPortalController(ICustomerPortalService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        /// <summary>The portal resolved from the route token by <see cref="ResolvePortalAttribute"/>.</summary>
        private ResolvedPortal Portal => (ResolvedPortal)HttpContext.Items[ResolvePortalAttribute.ItemsKey]!;

        /// <summary>The one response a caller ever gets for a token that doesn't work.</summary>
        private NotFoundObjectResult Gone() => NotFound(new
        {
            message = "This customer portal is no longer available.",
            statusCode = StatusCodes.Status404NotFound,
        });

        /// <summary>Company branding, customer name, and totals across every visible invoice.</summary>
        [HttpGet]
        public async Task<ActionResult<PortalHeaderDto>> GetPortal()
        {
            var header = await _service.GetHeaderAsync(Portal);
            return header == null ? Gone() : Ok(header);
        }

        [HttpGet("invoices")]
        public async Task<ActionResult<PagedResult<PortalInvoiceListItemDto>>> GetInvoices(
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? status = null,
            [FromQuery] string? search = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            // Same clamps as every internal paged endpoint — an anonymous caller
            // cannot ask for 999999 rows.
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            return Ok(await _service.GetInvoicesAsync(Portal, clampedPage, size, status, search, dateFrom, dateTo));
        }

        /// <summary>
        /// One invoice. The route carries the DOCUMENT number the customer already
        /// holds, not a database id, and it is looked up inside the portal's scope
        /// — so substituting another client's invoice number returns 404 rather
        /// than their document.
        /// </summary>
        [HttpGet("invoices/{invoiceNumber:int}")]
        public async Task<ActionResult<PortalInvoiceDetailDto>> GetInvoice(int invoiceNumber)
        {
            var dto = await _service.GetInvoiceAsync(Portal, invoiceNumber);
            return dto == null ? Gone() : Ok(dto);
        }

        /// <summary>
        /// Template + merge data for printing or saving the invoice as PDF. The
        /// company's configured default template is resolved server-side; the page
        /// merges and renders it in a sandboxed frame, exactly as the internal app
        /// merges it — there is no second renderer, and no server-side PDF writer
        /// exists in this solution to use instead.
        /// </summary>
        [HttpGet("invoices/{invoiceNumber:int}/print")]
        public async Task<ActionResult<PortalPrintPayloadDto>> GetPrintPayload(int invoiceNumber)
        {
            var payload = await _service.GetPrintPayloadAsync(Portal, invoiceNumber);
            if (payload == null)
                return NotFound(new
                {
                    message = "This invoice can't be printed right now.",
                    statusCode = StatusCodes.Status404NotFound,
                });
            return Ok(payload);
        }
    }
}
