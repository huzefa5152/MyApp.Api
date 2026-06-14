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
        private readonly int _defaultPageSize;
        private readonly ILogger<SalesQuotesController> _logger;

        public SalesQuotesController(ISalesQuoteService service, ICompanyAccessGuard access,
            IConfiguration configuration, ILogger<SalesQuotesController> logger)
        {
            _service = service;
            _access = access;
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
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var total = 0;
            foreach (var cid in allowed) total += await _service.GetCountByCompanyAsync(cid);
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("salesquotes.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<SalesQuoteDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

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
            [FromQuery] DateTime? dateTo = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            var result = await _service.GetPagedByCompanyAsync(
                companyId, clampedPage, size, search, status, clientId, dateFrom, dateTo);
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
            return Ok(quote);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("salesquotes.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<SalesQuoteDto>> Create(int companyId, [FromBody] SalesQuoteDto dto)
        {
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
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }
    }
}
