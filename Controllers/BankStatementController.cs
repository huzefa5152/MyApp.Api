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
    /// Bank statement import + categorization (BANK_RECONCILIATION_DESIGN.md
    /// Phase 2). Upload a statement CSV → staged lines auto-match to existing
    /// un-cleared payments (and clear them); the rest are categorized (created as
    /// an on-account receipt/payment) or ignored.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/bank-statements")]
    public class BankStatementController : ControllerBase
    {
        private readonly IBankStatementService _service;
        private readonly IAccountService _accounts;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<BankStatementController> _logger;

        public BankStatementController(
            IBankStatementService service, IAccountService accounts,
            ICompanyAccessGuard access, ILogger<BankStatementController> logger)
        {
            _service = service;
            _accounts = accounts;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private async Task<bool> AccountBelongsToCompanyAsync(int accountId, int companyId)
        {
            var a = await _accounts.GetAccountByIdAsync(accountId);
            return a != null && a.CompanyId == companyId;
        }

        [HttpPost("company/{companyId}/import")]
        [HasPermission("accounting.reconciliation.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<ImportStatementResultDto>> Import(int companyId, [FromBody] ImportStatementRequestDto dto)
        {
            if (!await AccountBelongsToCompanyAsync(dto.BankAccountId, companyId))
                return BadRequest(new { error = "That account does not belong to this company." });
            try { return Ok(await _service.ImportCsvAsync(companyId, dto.BankAccountId, dto.FileName ?? "", dto.CsvText)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Bank statement import failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not import the statement. Please check the file format and try again." });
            }
        }

        [HttpGet("account/{accountId}/lines")]
        [HasPermission("accounting.reconciliation.view")]
        public async Task<IActionResult> GetLines(int accountId, [FromQuery] string? status = null)
        {
            var acct = await _accounts.GetAccountByIdAsync(accountId);
            if (acct == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, acct.CompanyId);
            return Ok(await _service.GetLinesAsync(accountId, status));
        }

        [HttpPost("line/{lineId}/categorize")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> Categorize(int lineId, [FromBody] CategorizeLineDto dto)
        {
            var companyId = await _service.GetLineCompanyAsync(lineId);
            if (companyId == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            try
            {
                var ok = await _service.CategorizeLineAsync(lineId, dto);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Categorize statement line {LineId} failed", lineId);
                return StatusCode(500, new { error = "Could not categorize the line. Please try again." });
            }
        }

        [HttpPost("line/{lineId}/ignore")]
        [HasPermission("accounting.reconciliation.manage")]
        public async Task<IActionResult> Ignore(int lineId)
        {
            var companyId = await _service.GetLineCompanyAsync(lineId);
            if (companyId == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            var ok = await _service.IgnoreLineAsync(lineId);
            return ok ? NoContent() : NotFound();
        }
    }
}
