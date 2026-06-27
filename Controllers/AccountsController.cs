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
    /// Chart of Accounts (design §7): the two-statement account tree plus
    /// group/account CRUD and the sector-preset seed. Every endpoint asserts
    /// tenant access; control accounts are protected from delete in the service.
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

        [HttpGet("company/{companyId}/flat")]
        [HasPermission("accounting.coa.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AccountDto>>> GetFlat(int companyId)
            => Ok(await _service.GetAccountsFlatAsync(companyId));

        // ── Groups ──────────────────────────────────────────────────────────────

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

        // ── Sector preset ───────────────────────────────────────────────────────

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
