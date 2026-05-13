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
    /// Purchase-side counterpart of <see cref="InvoicesController"/>. Records
    /// supplier invoices (with their IRN), emits Stock IN movements when
    /// inventory tracking is on, and powers the Purchase Bills page.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class PurchaseBillsController : ControllerBase
    {
        private readonly IPurchaseBillService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly int _defaultPageSize;

        public PurchaseBillsController(IPurchaseBillService service, ICompanyAccessGuard access, IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("purchasebills.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<int>> GetCount([FromQuery] int companyId)
            => Ok(await _service.GetCountByCompanyAsync(companyId));

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("purchasebills.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<PurchaseBillDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] int? supplierId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            var result = await _service.GetPagedByCompanyAsync(companyId, clampedPage, size, search, supplierId, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("purchasebills.list.view")]
        public async Task<ActionResult<PurchaseBillDto>> GetById(int id)
        {
            var pb = await _service.GetByIdAsync(id);
            if (pb == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, pb.CompanyId);
            return Ok(pb);
        }

        [HttpPost]
        [HasPermission("purchasebills.manage.create")]
        public async Task<ActionResult<PurchaseBillDto>> Create([FromBody] CreatePurchaseBillDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                var created = await _service.CreateAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("purchasebills.manage.update")]
        public async Task<ActionResult<PurchaseBillDto>> Update(int id, [FromBody] UpdatePurchaseBillDto dto)
        {
            // Authorize on the existing row's company — body fields can't
            // smuggle the bill into another tenant.
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("purchasebills.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var ok = await _service.DeleteAsync(id);
            if (!ok) return NotFound();
            return Ok(new { message = "Purchase bill deleted; stock movements reversed." });
        }
    }
}
