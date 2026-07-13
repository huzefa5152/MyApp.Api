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
        private readonly IAccountService _accounts;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<BankReconciliationController> _logger;

        public BankReconciliationController(
            IBankReconciliationService service, IPaymentService payments,
            IAccountTransferService transfers, IAccountService accounts,
            ICompanyAccessGuard access, ILogger<BankReconciliationController> logger)
        {
            _service = service;
            _payments = payments;
            _transfers = transfers;
            _accounts = accounts;
            _access = access;
            _logger = logger;
        }

        // Load an account and assert the caller can access its company (tenant guard
        // for account-scoped routes). Returns false + sets NotFound when missing.
        private async Task<(bool ok, IActionResult? fail)> GuardAccountAsync(int accountId)
        {
            var acct = await _accounts.GetAccountByIdAsync(accountId);
            if (acct == null) return (false, NotFound());
            await _access.AssertAccessAsync(CurrentUserId, acct.CompanyId);
            return (true, null);
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

        [HttpGet("account/{accountId}/transactions")]
        [HasPermission("accounting.reconciliation.view")]
        public async Task<IActionResult> GetTransactions(int accountId)
        {
            var (ok, fail) = await GuardAccountAsync(accountId);
            if (!ok) return fail!;
            return Ok(await _service.GetAccountTransactionsAsync(accountId));
        }

        [HttpGet("account/{accountId}/history")]
        [HasPermission("accounting.reconciliation.view")]
        public async Task<IActionResult> GetHistory(int accountId)
        {
            var (ok, fail) = await GuardAccountAsync(accountId);
            if (!ok) return fail!;
            return Ok(await _service.GetReconciliationsAsync(accountId));
        }

        [HttpPost("company/{companyId}/lock")]
        [HasPermission("accounting.reconciliation.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<BankReconciliationDto>> Lock(int companyId, [FromBody] LockReconciliationDto dto)
        {
            try { return Ok(await _service.LockReconciliationAsync(companyId, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Lock reconciliation failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not lock the reconciliation. Please try again." });
            }
        }

        [HttpPost("payment/{id}/cleared")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> SetPaymentCleared(int id, [FromBody] SetClearedDto dto)
        {
            // Load-then-assert against the STORED CompanyId (never a body field).
            var payment = await _payments.GetByIdAsync(id);
            if (payment == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, payment.CompanyId);
            try
            {
                var ok = await _service.SetPaymentClearedAsync(id, dto.Cleared, dto.ClearedDate);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPost("transfer/{id}/cleared")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> SetTransferCleared(int id, [FromBody] SetClearedDto dto)
        {
            var transfer = await _transfers.GetByIdAsync(id);
            if (transfer == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, transfer.CompanyId);
            try
            {
                var ok = await _service.SetTransferClearedAsync(id, dto.Cleared, dto.ClearedDate);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }
    }
}
