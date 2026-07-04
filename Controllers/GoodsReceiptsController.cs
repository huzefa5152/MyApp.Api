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
    public class GoodsReceiptsController : ControllerBase
    {
        private readonly IGoodsReceiptService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _defaultPageSize;

        public GoodsReceiptsController(IGoodsReceiptService service, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("goodsreceipts.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<GoodsReceiptDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] int? supplierId = null,
            [FromQuery] string? status = null,
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
            var result = await _service.GetPagedByCompanyAsync(companyId, clampedPage, size, search, supplierId, status, dateFrom, dateTo, divisionId, divScope);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("goodsreceipts.list.view")]
        public async Task<ActionResult<GoodsReceiptDto>> GetById(int id)
        {
            var gr = await _service.GetByIdAsync(id);
            if (gr == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, gr.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, gr.CompanyId, gr.DivisionId);
            return Ok(gr);
        }

        [HttpPost]
        [HasPermission("goodsreceipts.manage.create")]
        public async Task<ActionResult<GoodsReceiptDto>> Create([FromBody] CreateGoodsReceiptDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Division-restricted users must tag the receipt with one of their
            // divisions (write-assert also rejects null — policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, dto.DivisionId);
            try
            {
                var created = await _service.CreateAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}")]
        [HasPermission("goodsreceipts.manage.update")]
        public async Task<ActionResult<GoodsReceiptDto>> Update(int id, [FromBody] UpdateGoodsReceiptDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            // Division is immutable on update (UpdateGoodsReceiptDto carries
            // none) — the read-assert on the stored tag is sufficient.
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var updated = await _service.UpdateAsync(id, dto);
            if (updated == null) return NotFound();
            return Ok(updated);
        }

        [HttpDelete("{id}")]
        [HasPermission("goodsreceipts.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var ok = await _service.DeleteAsync(id);
            if (!ok) return NotFound();
            return NoContent();
        }
    }
}
