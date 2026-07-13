using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Bank reconciliation (BANK_RECONCILIATION_DESIGN.md). Read model for the
    /// Bank &amp; Cash Accounts columns (actual / cleared / pending) plus the
    /// cleared-state toggles. A pure metadata layer over the GL — toggling cleared
    /// never posts or moves money.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/bank-reconciliation")]
    public class BankReconciliationController : ControllerBase
    {
        private readonly IBankReconciliationService _service;
        private readonly IPaymentService _payments;
        private readonly IAccountTransferService _transfers;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<BankReconciliationController> _logger;

        public BankReconciliationController(
            IBankReconciliationService service, IPaymentService payments,
            IAccountTransferService transfers, ICompanyAccessGuard access,
            ILogger<BankReconciliationController> logger)
        {
            _service = service;
            _payments = payments;
            _transfers = transfers;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}/summary")]
        [HasPermission("accounting.reconciliation.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<BankAccountReconSummaryDto>>> GetSummary(int companyId)
            => Ok(await _service.GetAccountSummariesAsync(companyId));

        [HttpPost("payment/{id}/cleared")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> SetPaymentCleared(int id, [FromBody] SetClearedDto dto)
        {
            // Load-then-assert against the STORED CompanyId (never a body field).
            var payment = await _payments.GetByIdAsync(id);
            if (payment == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, payment.CompanyId);
            var ok = await _service.SetPaymentClearedAsync(id, dto.Cleared, dto.ClearedDate);
            return ok ? NoContent() : NotFound();
        }

        [HttpPost("transfer/{id}/cleared")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> SetTransferCleared(int id, [FromBody] SetClearedDto dto)
        {
            var transfer = await _transfers.GetByIdAsync(id);
            if (transfer == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, transfer.CompanyId);
            var ok = await _service.SetTransferClearedAsync(id, dto.Cleared, dto.ClearedDate);
            return ok ? NoContent() : NotFound();
        }
    }
}
