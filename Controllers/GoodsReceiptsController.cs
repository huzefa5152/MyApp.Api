using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
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
        private readonly int _defaultPageSize;

        public GoodsReceiptsController(IGoodsReceiptService service, ICompanyAccessGuard access, IConfiguration configuration)
        {
            _service = service;
            _access = access;
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
            [FromQuery] DateTime? dateTo = null)
        {
            var size = pageSize ?? _defaultPageSize;
            var result = await _service.GetPagedByCompanyAsync(companyId, page, size, search, supplierId, status, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("goodsreceipts.list.view")]
        public async Task<ActionResult<GoodsReceiptDto>> GetById(int id)
        {
            var gr = await _service.GetByIdAsync(id);
            if (gr == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, gr.CompanyId);
            return Ok(gr);
        }

        [HttpPost]
        [HasPermission("goodsreceipts.manage.create")]
        public async Task<ActionResult<GoodsReceiptDto>> Create([FromBody] CreateGoodsReceiptDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
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
            var ok = await _service.DeleteAsync(id);
            if (!ok) return NotFound();
            return NoContent();
        }
    }
}
