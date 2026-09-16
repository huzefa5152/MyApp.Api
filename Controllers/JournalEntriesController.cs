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
    /// Journal Entries — the general-ledger browser plus manual journals.
    ///
    /// The listing shows EVERY entry, system-posted and manual alike, so the
    /// screen doubles as the ledger view. Create, edit and delete apply to
    /// MANUAL entries only: a system-posted entry is maintained by the posting
    /// engine and changes with its source document, so editing it here would be
    /// silently undone the next time that document is saved.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/journal-entries")]
    public class JournalEntriesController : ControllerBase
    {
        private readonly IJournalEntryService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<JournalEntriesController> _logger;
        private readonly int _defaultPageSize;

        public JournalEntriesController(
            IJournalEntryService service, ICompanyAccessGuard access,
            ILogger<JournalEntriesController> logger, IConfiguration configuration)
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
        [HasPermission("accounting.journal.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<JournalEntryDto>>> GetPaged(
            int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null, [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null, [FromQuery] bool manualOnly = false)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            return Ok(await _service.GetPagedAsync(companyId, clampedPage, size, search, dateFrom, dateTo, manualOnly));
        }

        [HttpGet("{id}")]
        [HasPermission("accounting.journal.view")]
        public async Task<ActionResult<JournalEntryDto>> GetById(int id)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("accounting.journal.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<JournalEntryDto>> Create(int companyId, [FromBody] CreateJournalEntryDto dto)
        {
            try { return Ok(await _service.CreateManualAsync(companyId, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create manual journal failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not save the journal entry." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("accounting.journal.update")]
        public async Task<ActionResult<JournalEntryDto>> Update(int id, [FromBody] CreateJournalEntryDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateManualAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Update manual journal {Id} failed", id);
                return StatusCode(500, new { error = "Could not save the journal entry." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("accounting.journal.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteManualAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }
    }
}
