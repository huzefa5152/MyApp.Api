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
    /// Chart of Accounts: the two-statement account tree, group/account CRUD and
    /// the sector-preset seed.
    ///
    /// Endpoints that take a companyId on the ROUTE carry
    /// <c>[AuthorizeCompany]</c>, which runs the tenant guard before model
    /// binding. Endpoints keyed on an account/group id load the row first and
    /// assert against ITS stored CompanyId — the id in the URL is never trusted
    /// to describe which tenant it belongs to.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/accounts")]
    public class AccountsController : ControllerBase
    {
        private readonly IAccountService _service;
        private readonly ICoaPresetSeeder _seeder;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<AccountsController> _logger;

        public AccountsController(
            IAccountService service, ICoaPresetSeeder seeder,
            ICompanyAccessGuard access, ILogger<AccountsController> logger)
        {
            _service = service;
            _seeder = seeder;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // ── Reads ─────────────────────────────────────────────────────────────

        [HttpGet("company/{companyId}/tree")]
        [HasPermission("accounting.coa.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<CoaTreeDto>> GetTree(int companyId)
            => Ok(await _service.GetTreeAsync(companyId));

        /// <summary>Flat account list feeding the per-line GL account picker on
        /// bills, purchase bills and payment adjustments. Anyone who can record
        /// one of those documents can populate the picker without also being
        /// granted the Chart of Accounts screen.</summary>
        [HttpGet("company/{companyId}/flat")]
        [HasAnyPermission("accounting.coa.view",
            "accounting.receipts.create", "accounting.payments.create",
            "bills.manage.create", "bills.manage.update",
            "purchasebills.manage.create", "purchasebills.manage.update")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AccountDto>>> GetFlat(int companyId)
            => Ok(await _service.GetAccountsFlatAsync(companyId));

        /// <summary>Bank/cash accounts for the receipt/payment "Received in /
        /// Paid from" picker. Gated so anyone who can record or read a
        /// receipt/payment (or view the chart) can populate it.</summary>
        [HttpGet("company/{companyId}/bank-cash")]
        [HasAnyPermission("accounting.coa.view",
            "accounting.receipts.view", "accounting.receipts.create",
            "accounting.payments.view", "accounting.payments.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AccountDto>>> GetBankCash(int companyId, [FromQuery] bool includeInactive = false)
            => Ok(await _service.GetBankCashAccountsAsync(companyId, includeInactive));

        // ── Groups ────────────────────────────────────────────────────────────

        [HttpPost("company/{companyId}/groups")]
        [HasPermission("accounting.coa.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<AccountGroupDto>> CreateGroup(int companyId, [FromBody] CreateAccountGroupDto dto)
        {
            try { return Ok(await _service.CreateGroupAsync(companyId, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("groups/{id}")]
        [HasPermission("accounting.coa.manage")]
        public async Task<ActionResult<AccountGroupDto>> UpdateGroup(int id, [FromBody] UpdateAccountGroupDto dto)
        {
            var existing = await _service.GetGroupByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateGroupAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("groups/{id}")]
        [HasPermission("accounting.coa.manage")]
        public async Task<IActionResult> DeleteGroup(int id)
        {
            var existing = await _service.GetGroupByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteGroupAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        // ── Accounts ──────────────────────────────────────────────────────────

        [HttpPost("company/{companyId}")]
        [HasPermission("accounting.coa.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<AccountDto>> CreateAccount(int companyId, [FromBody] CreateAccountDto dto)
        {
            try { return Ok(await _service.CreateAccountAsync(companyId, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}")]
        [HasPermission("accounting.coa.manage")]
        public async Task<ActionResult<AccountDto>> UpdateAccount(int id, [FromBody] UpdateAccountDto dto)
        {
            var existing = await _service.GetAccountByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAccountAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Correct a bank/cash account's opening balance; the offsetting
        /// delta lands on Retained earnings so the balance sheet stays balanced.</summary>
        [HttpPost("{id}/adjust-opening-balance")]
        [HasPermission("accounting.coa.manage")]
        public async Task<ActionResult<AccountDto>> AdjustOpeningBalance(int id, [FromBody] AdjustOpeningBalanceDto dto)
        {
            var existing = await _service.GetAccountByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.AdjustOpeningBalanceAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id}")]
        [HasPermission("accounting.coa.manage")]
        public async Task<IActionResult> DeleteAccount(int id)
        {
            var existing = await _service.GetAccountByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteAccountAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        // ── Sector preset ─────────────────────────────────────────────────────

        [HttpPost("company/{companyId}/seed-wholesale")]
        [HasPermission("accounting.coa.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SeedWholesale(int companyId)
        {
            try
            {
                var n = await _seeder.SeedWholesaleAsync(companyId);
                return Ok(new { created = n, message = n == 0 ? "Preset already present." : $"Seeded {n} groups/accounts." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Seed wholesale CoA failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not seed the chart of accounts." });
            }
        }
    }
}
