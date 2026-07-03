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
    /// Inter-account transfers — money moved between two of the company's own
    /// bank/cash accounts (the reference product's "Inter Account Transfers"
    /// tab). No contact involved; GL posting is Dr receiving / Cr paying.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/account-transfers")]
    public class AccountTransfersController : ControllerBase
    {
        private readonly IAccountTransferService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<AccountTransfersController> _logger;
        private readonly int _defaultPageSize;

        public AccountTransfersController(
            IAccountTransferService service, ICompanyAccessGuard access,
            ILogger<AccountTransfersController> logger, IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _logger = logger;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("accounting.transfers.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<AccountTransferDto>>> GetPaged(
            int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            var result = await _service.GetPagedAsync(companyId, clampedPage, size, search, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("accounting.transfers.view")]
        public async Task<IActionResult> GetTransfer(int id)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("accounting.transfers.create")]
        [AuthorizeCompany]
        public async Task<IActionResult> Create(int companyId, [FromBody] CreateAccountTransferDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetTransfer), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create account transfer failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not save the document. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("accounting.transfers.create")]
        public async Task<IActionResult> Update(int id, [FromBody] CreateAccountTransferDto dto)
        {
            // Load-then-assert: authorize against the STORED CompanyId, never a
            // body field (body ids can be forged — CLAUDE.md §1).
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Update account transfer {Id} failed", id);
                return StatusCode(500, new { error = "Could not save the document. Please try again." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("accounting.transfers.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Delete account transfer {Id} failed", id);
                return StatusCode(500, new { error = "Could not delete the document. Please try again." });
            }
        }
    }
}
