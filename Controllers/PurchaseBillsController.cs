using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
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
        private readonly int _defaultPageSize;

        public PurchaseBillsController(IPurchaseBillService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        [HttpGet("count")]
        [HasPermission("purchasebills.list.view")]
        public async Task<ActionResult<int>> GetCount([FromQuery] int companyId)
            => Ok(await _service.GetCountByCompanyAsync(companyId));

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("purchasebills.list.view")]
        public async Task<ActionResult<PagedResult<PurchaseBillDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] int? supplierId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = pageSize ?? _defaultPageSize;
            var result = await _service.GetPagedByCompanyAsync(companyId, page, size, search, supplierId, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("purchasebills.list.view")]
        public async Task<ActionResult<PurchaseBillDto>> GetById(int id)
        {
            var pb = await _service.GetByIdAsync(id);
            if (pb == null) return NotFound();
            return Ok(pb);
        }

        [HttpPost]
        [HasPermission("purchasebills.manage.create")]
        public async Task<ActionResult<PurchaseBillDto>> Create([FromBody] CreatePurchaseBillDto dto)
        {
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
            var ok = await _service.DeleteAsync(id);
            if (!ok) return NotFound();
            return Ok(new { message = "Purchase bill deleted; stock movements reversed." });
        }
    }
}
