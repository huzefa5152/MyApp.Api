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
    public class DeliveryChallansController : ControllerBase
    {
        private readonly IDeliveryChallanService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly int _defaultPageSize;

        public DeliveryChallansController(IDeliveryChallanService service, ICompanyAccessGuard access, IConfiguration configuration)
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
        [HasPermission("challans.list.view")]
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            }
            // Total across companies — narrow to caller's accessible set so a
            // tenant-scoped user doesn't see "you have N challans" rolled up
            // across companies they cannot reach.
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var total = 0;
            foreach (var cid in allowed)
                total += await _service.GetCountByCompanyAsync(cid);
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("challans.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetByCompany(int companyId)
        {
            var challans = await _service.GetDeliveryChallansByCompanyAsync(companyId);
            return Ok(challans);
        }

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("challans.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<DeliveryChallanDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] string? status = null,
            [FromQuery] int? clientId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = pageSize ?? _defaultPageSize;
            var result = await _service.GetPagedByCompanyAsync(
                companyId, page, size, search, status, clientId, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("company/{companyId}/pending")]
        [HasPermission("challans.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetPendingByCompany(int companyId)
        {
            var challans = await _service.GetPendingChallansByCompanyAsync(companyId);
            return Ok(challans);
        }

        [HttpGet("{id}")]
        [HasPermission("challans.list.view")]
        public async Task<ActionResult<DeliveryChallanDto>> GetById(int id)
        {
            var challan = await _service.GetByIdAsync(id);
            if (challan == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, challan.CompanyId);
            return Ok(challan);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("challans.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<DeliveryChallanDto>> Create(int companyId, [FromBody] DeliveryChallanDto dto)
        {
            try
            {
                if (dto.ClientId <= 0)
                    return BadRequest(new { error = "Invalid client." });
                if (!dto.DeliveryDate.HasValue)
                    return BadRequest(new { error = "Delivery date is required." });
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item is required." });
                if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                    return BadRequest(new { error = "Item descriptions cannot be empty." });
                if (dto.Items.Any(i => i.Quantity <= 0))
                    return BadRequest(new { error = "Item quantity must be greater than zero." });

                var created = await _service.CreateDeliveryChallanAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex)
            {
                // Domain validation failures (decimal qty for integer-only
                // UOM, FBR pre-condition violations, etc.) — surface as 400
                // so the operator sees a clear actionable message instead
                // of a generic server error.
                return BadRequest(new { error = ex.Message });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        [HttpPut("{id}/items")]
        [HasPermission("challans.manage.update")]
        public async Task<ActionResult<DeliveryChallanDto>> UpdateItems(int id, [FromBody] List<DeliveryItemDto> items)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateItemsAsync(id, items);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("{id}/po")]
        [HasPermission("challans.manage.update")]
        public async Task<ActionResult<DeliveryChallanDto>> UpdatePo(int id, [FromBody] UpdatePoDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                if (string.IsNullOrWhiteSpace(dto.PoNumber))
                    return BadRequest(new { error = "PO number is required." });
                var updated = await _service.UpdatePoAsync(id, dto.PoNumber, dto.PoDate);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Full-field challan update. Lets the operator change client, site,
        /// delivery date, PO number (including CLEARING it → "No PO"), PO date,
        /// and items in a single request. Replaces the old two-step
        /// "update items" + "update PO" flow.
        /// </summary>
        [HttpPut("{id}")]
        [HasPermission("challans.manage.update")]
        public async Task<ActionResult<DeliveryChallanDto>> UpdateChallan(int id, [FromBody] DeliveryChallanDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                // Items must still contain at least one row and have valid data.
                // PO number and site are optional — empty string on PO transitions
                // the challan to "No PO" status (operator's intent).
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item is required." });
                if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                    return BadRequest(new { error = "Item descriptions cannot be empty." });
                if (dto.Items.Any(i => i.Quantity <= 0))
                    return BadRequest(new { error = "Item quantity must be greater than zero." });
                if (!dto.DeliveryDate.HasValue)
                    return BadRequest(new { error = "Delivery date is required." });

                var updated = await _service.UpdateChallanAsync(id, dto);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("{id}/cancel")]
        [HasPermission("challans.manage.update")]
        public async Task<IActionResult> Cancel(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var result = await _service.CancelAsync(id);
                if (!result) return NotFound();
                return Ok(new { message = "Challan cancelled." });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("challans.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var result = await _service.DeleteAsync(id);
                if (!result) return NotFound();
                return NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("items/{itemId}")]
        [HasPermission("challans.manage.update")]
        public async Task<IActionResult> DeleteItem(int itemId)
        {
            try
            {
                var result = await _service.DeleteItemAsync(itemId);
                if (!result) return NotFound();
                return NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpGet("{id}/print")]
        [HasPermission("challans.print.view")]
        public async Task<ActionResult<PrintChallanDto>> GetPrintData(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var dto = await _service.GetPrintDataAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }
    }
}
