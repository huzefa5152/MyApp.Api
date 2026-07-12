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
    /// Journal Entries (design §11.1) — the general-ledger view plus manual
    /// journals. Listing shows EVERY entry (system-posted + manual) so the
    /// module doubles as the ledger browser; create/edit/delete apply to
    /// MANUAL entries only — system-posted ones are maintained by the posting
    /// engine and change with their source document.
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
            var result = await _service.GetPagedAsync(
                companyId, clampedPage, size, search, dateFrom, dateTo, manualOnly);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("accounting.journal.view")]
        public async Task<IActionResult> GetById(int id)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        [HttpGet("{id}/print")]
        [HasPermission("accounting.journal.print")]
        public async Task<ActionResult<PrintJournalEntryDto>> GetPrintData(int id)
        {
            var je = await _service.GetByIdAsync(id);
            if (je == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, je.CompanyId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("accounting.journal.create")]
        [AuthorizeCompany]
        public async Task<IActionResult> Create(int companyId, [FromBody] CreateJournalEntryDto dto)
        {
            try
            {
                var created = await _service.CreateManualAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create journal entry failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not save the journal entry. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("accounting.journal.create")]
        public async Task<IActionResult> Update(int id, [FromBody] CreateJournalEntryDto dto)
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
                _logger.LogError(ex, "Update journal entry {Id} failed", id);
                return StatusCode(500, new { error = "Could not save the journal entry. Please try again." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("accounting.journal.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                var ok = await _service.DeleteManualAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Delete journal entry {Id} failed", id);
                return StatusCode(500, new { error = "Could not delete the journal entry. Please try again." });
            }
        }
    }
}
