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
    /// The PUBLIC Customer Portal. Deliberately unauthenticated: the token in
    /// the route is the entire access control, and it is a 256-bit CSPRNG value.
    ///
    /// This is only the second anonymous controller in the codebase (the other
    /// is ProductImagesController), so the reasoning is written down here rather
    /// than assumed:
    ///
    ///  • Authorization in this app is OPT-IN per controller — there is no
    ///    global fallback policy — so <c>[AllowAnonymous]</c> is carried
    ///    EXPLICITLY rather than relying on the absence of <c>[Authorize]</c>.
    ///    That makes the intent greppable, and it survives someone adding a
    ///    global policy later.
    ///  • <c>[ResolvePortal]</c> runs before every action and turns the token
    ///    into a company plus a client. Actions never accept a company, client
    ///    or invoice ID from the caller, so there is no parameter to tamper
    ///    with: the invoice NUMBER in the route is resolved within the portal's
    ///    scope, and a number belonging to another client simply does not exist
    ///    from here. Absent beats validated.
    ///  • Every failure returns the same 404 body, so the endpoint cannot be
    ///    used to confirm that a token was ever valid.
    ///  • The rate limit partitions on the TOKEN rather than the IP, because
    ///    behind the host's proxy the remote IP is not reliably the caller's
    ///    (ForwardedHeaders:KnownProxies is still unset — audit C-12). The limit
    ///    is there to stop noise; at 256 bits of entropy nothing about secrecy
    ///    rests on it.
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

        /// <summary>The portal resolved from the route token by the filter. The
        /// ONLY source of scope on this controller.</summary>
        private ResolvedPortal Portal => (ResolvedPortal)HttpContext.Items[ResolvePortalAttribute.ItemsKey]!;

        /// <summary>The one response a caller ever gets for anything that does
        /// not work. Identical wording to the filter's, on purpose.</summary>
        private NotFoundObjectResult Gone() => NotFound(new
        {
            message = "This customer portal is no longer available.",
            statusCode = StatusCodes.Status404NotFound,
        });

        /// <summary>Company branding, the customer's name, and their position
        /// across every visible invoice.</summary>
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
            // The same clamps every internal paged endpoint uses — an anonymous
            // caller cannot ask for 999999 rows.
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize, PaginationHelper.AuditMax);
            var clampedPage = PaginationHelper.ClampPage(page);
            return Ok(await _service.GetInvoicesAsync(Portal, clampedPage, size, status, search, dateFrom, dateTo));
        }

        /// <summary>
        /// One invoice. The route carries the DOCUMENT number the customer
        /// already holds, not a database id, and it is looked up inside the
        /// portal's scope — so substituting another client's invoice number
        /// returns the same 404 as a nonexistent one, not their document.
        /// </summary>
        [HttpGet("invoices/{invoiceNumber:int}")]
        public async Task<ActionResult<PortalInvoiceDetailDto>> GetInvoice(int invoiceNumber)
        {
            var dto = await _service.GetInvoiceAsync(Portal, invoiceNumber);
            return dto == null ? Gone() : Ok(dto);
        }

        /// <summary>
        /// Template plus merge data for printing or saving the invoice as a PDF.
        /// The company's template is resolved server-side and only the one
        /// document's worth is sent, so the template library is never published.
        /// The page merges and renders it exactly as the internal app does —
        /// there is no second renderer to disagree with the office's copy.
        /// </summary>
        [HttpGet("invoices/{invoiceNumber:int}/print")]
        public async Task<ActionResult<PortalPrintPayloadDto>> GetPrintPayload(int invoiceNumber)
        {
            var payload = await _service.GetPrintPayloadAsync(Portal, invoiceNumber);
            return payload == null ? Gone() : Ok(payload);
        }
    }
}
