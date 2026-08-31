using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Read-only HTTP surface over <see cref="ICustomerLedgerService"/> — the
    /// derived per-customer money in/out trail (design §11.5 follow-on, Task 6).
    /// Nothing here writes; every figure is computed live from invoices, notes,
    /// receipts and their allocations, so there is nothing to create/update/delete.
    ///
    /// Both routes take <c>companyId</c> from the URL and are asserted against
    /// <see cref="ICompanyAccessGuard"/> BEFORE anything else runs. The per-client
    /// route additionally resolves <c>clientId</c> INSIDE that company scope (the
    /// service does this — see <see cref="ICustomerLedgerService.GetForClientAsync"/>)
    /// so a client id that belongs to a different company 404s exactly like an
    /// unknown one, rather than confirming it exists elsewhere.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/customer-ledger")]
    public class CustomerLedgerController : ControllerBase
    {
        private readonly ICustomerLedgerService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<CustomerLedgerController> _logger;

        public CustomerLedgerController(
            ICustomerLedgerService service, ICompanyAccessGuard access,
            ILogger<CustomerLedgerController> logger)
        {
            _service = service;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>Per-customer aggregates for one company — the ledger's
        /// summary/list view (opening/invoiced/received/closing per customer,
        /// rolled up by ClientGroup). See <see cref="CustomerLedgerRowDto"/>.</summary>
        [HttpGet("company/{companyId}")]
        [HasPermission("customerledger.list.view")]
        public async Task<ActionResult<List<CustomerLedgerRowDto>>> GetAll(
            int companyId, [FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            try
            {
                return Ok(await _service.GetAllCustomersAsync(companyId, from, to));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Customer ledger list failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not load the customer ledger." });
            }
        }

        /// <summary>One customer's full chronological trail (paged, newest-first),
        /// with an opening/closing balance for the requested window. See
        /// <see cref="CustomerLedgerDto"/>.</summary>
        [HttpGet("company/{companyId}/client/{clientId}")]
        [HasPermission("customerledger.list.view")]
        public async Task<ActionResult<CustomerLedgerDto>> GetForClient(
            int companyId, int clientId,
            [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? type,
            [FromQuery] int page = 1, [FromQuery] int? pageSize = null)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            try
            {
                return Ok(await _service.GetForClientAsync(companyId, clientId, from, to, type, page, pageSize));
            }
            catch (InvalidOperationException)
            {
                // The service resolves clientId INSIDE the companyId scope and
                // throws this when the pair doesn't match — a foreign id (one
                // that belongs to another company, or none at all) must 404
                // exactly like an unknown one, never leak that it exists
                // elsewhere. See ICustomerLedgerService.GetForClientAsync's
                // documented <exception> contract.
                return NotFound(new { error = "Customer not found." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Customer ledger fetch failed for company {CompanyId}, client {ClientId}", companyId, clientId);
                return StatusCode(500, new { error = "Could not load the customer ledger." });
            }
        }
    }
}
