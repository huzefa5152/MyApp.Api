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
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SalesQuotesController : ControllerBase
    {
        private readonly ISalesQuoteService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _defaultPageSize;
        private readonly ILogger<SalesQuotesController> _logger;

        public SalesQuotesController(ISalesQuoteService service, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IConfiguration configuration, ILogger<SalesQuotesController> logger)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("salesquotes.list.view")]
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value, divScope));
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var total = 0;
            foreach (var cid in allowed)
            {
                var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, cid);
                total += await _service.GetCountByCompanyAsync(cid, divScope);
            }
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("salesquotes.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<SalesQuoteDto>>> GetByCompany(int companyId)
        {
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _service.GetByCompanyAsync(companyId, divScope));
        }

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("salesquotes.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<SalesQuoteDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] string? status = null,
            [FromQuery] int? clientId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? divisionId = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            // Division RBAC: an explicit divisionId filter must be one the
            // caller can access; without a filter, restricted users get their
            // scope applied inside the query (company-level rows included).
            if (divisionId.HasValue)
                await _divisionAccess.AssertAccessAsync(CurrentUserId, companyId, divisionId.Value);
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            var result = await _service.GetPagedByCompanyAsync(
                companyId, clampedPage, size, search, status, clientId, dateFrom, dateTo, divisionId, divScope);
            return Ok(result);
        }

        [HttpGet("company/{companyId}/item-rate")]
        [HasPermission("salesquotes.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<QuoteItemRateDto>> GetItemRate(
            int companyId, [FromQuery] string? description = null, [FromQuery] int? itemTypeId = null)
            => Ok(await _service.GetItemRateAsync(companyId, description, itemTypeId));

        [HttpGet("{id}")]
        [HasPermission("salesquotes.list.view")]
        public async Task<ActionResult<SalesQuoteDto>> GetById(int id)
        {
            var quote = await _service.GetByIdAsync(id);
            if (quote == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, quote.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, quote.CompanyId, quote.DivisionId);
            return Ok(quote);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("salesquotes.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<SalesQuoteDto>> Create(int companyId, [FromBody] SalesQuoteDto dto)
        {
            // Division-restricted users must tag the quote with one of their
            // divisions (write-assert also rejects null — policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, dto.DivisionId);
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create sales quote failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not create the quote. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("salesquotes.manage.update")]
        public async Task<ActionResult<SalesQuoteDto>> Update(int id, [FromBody] SalesQuoteDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            // Moving the quote to a different division (or clearing it) needs
            // write access to the TARGET scope, not just the current one.
            if (dto.DivisionId != existing.DivisionId)
                await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, existing.CompanyId, dto.DivisionId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}/status")]
        [HasPermission("salesquotes.manage.update")]
        public async Task<IActionResult> SetStatus(int id, [FromBody] SetStatusDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var ok = await _service.SetStatusAsync(id, dto.Status);
                return ok ? Ok(new { message = $"Quote marked {dto.Status}." }) : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPost("{id}/convert-to-order")]
        [HasPermission("salesorders.manage.create")]
        public async Task<ActionResult<SalesOrderDto>> ConvertToOrder(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            // The new order inherits the quote's division, so read access to
            // the quote's division is the right gate for the conversion.
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var order = await _service.ConvertToSalesOrderAsync(id);
                return Ok(order);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException) { return NotFound(); }
        }

        [HttpDelete("{id}")]
        [HasPermission("salesquotes.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpGet("{id}/print")]
        [HasPermission("salesquotes.print.view")]
        public async Task<ActionResult<PrintQuoteDto>> GetPrintData(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }
    }
}
