using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The INTERNAL entry point for bulk invoice download / consolidated print.
    /// Thin by design: it authorises, builds an <see cref="InvoiceBulkScope"/>,
    /// and hands off to <see cref="IInvoiceBulkService"/> — the same service the
    /// public Customer Portal calls. No selection, template or naming logic
    /// lives here, so the two surfaces cannot drift apart.
    ///
    /// A SEPARATE controller rather than another action on
    /// <c>InvoicesController</c>, for two reasons: that file is already 780
    /// lines with six concerns in it, and it diverges by ~157 lines between this
    /// branch and <c>customize-solution-for-other</c>, so a new file is what
    /// makes this feature cherry-pick cleanly.
    ///
    /// Permissions reuse the existing print keys — <c>invoices.print.view</c>
    /// for a Sales Tax Invoice, <c>bills.print.view</c> for a Bill — because
    /// this produces exactly the documents those keys already grant, in
    /// quantity. Both are accepted at the action and the SPECIFIC one is then
    /// checked against the requested document type, so a role that may print
    /// bills cannot bulk-download tax invoices.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/invoices/bulk")]
    public class InvoiceBulkController : ControllerBase
    {
        private readonly IInvoiceBulkService _bulk;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly IPermissionService _permissions;

        public InvoiceBulkController(
            IInvoiceBulkService bulk, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IPermissionService permissions)
        {
            _bulk = bulk;
            _access = access;
            _divisionAccess = divisionAccess;
            _permissions = permissions;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Resolve the batch of invoices to render for one company, under the
        /// caller's own company and division access.
        ///
        /// The company arrives in the ROUTE and is asserted twice — once by
        /// <c>[AuthorizeCompany]</c> before the action, once here — so an
        /// administrator assigned to company A cannot reach company B's
        /// invoices by editing the request. Nothing in the body grants access:
        /// <c>clientId</c> and <c>divisionId</c> only narrow the set.
        /// </summary>
        [HttpPost("company/{companyId:int}")]
        [HasAnyPermission("invoices.print.view", "bills.print.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<InvoiceBulkBatchDto>> Resolve(
            int companyId, [FromBody] InvoiceBulkRequestDto request)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            // The document type decides WHICH print permission is required. A
            // caller holding only bills.print.view must not be able to ask for
            // tax invoices just because the action accepts either key.
            var wantsTaxInvoice = !string.Equals(request.DocumentType, "Bill", StringComparison.OrdinalIgnoreCase);
            var needed = wantsTaxInvoice ? "invoices.print.view" : "bills.print.view";
            if (!await _permissions.HasPermissionAsync(CurrentUserId, needed))
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    error = wantsTaxInvoice
                        ? "You do not have permission to print Sales Tax Invoices."
                        : "You do not have permission to print Bills.",
                });

            // An explicit division filter must be one the caller can reach;
            // without one, their accessible set is applied inside the query.
            if (request.DivisionId.HasValue)
                await _divisionAccess.AssertAccessAsync(CurrentUserId, companyId, request.DivisionId.Value);
            var divisionScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);

            var scope = InvoiceBulkScope.ForUser(companyId, divisionScope);
            try
            {
                return Ok(await _bulk.ResolveBatchAsync(scope, request));
            }
            catch (InvalidOperationException ex)
            {
                // Bad date ordering, or a pinned template that is not this
                // company's — both are the caller's input, so say which.
                return BadRequest(new { error = ex.Message });
            }
        }
    }
}
