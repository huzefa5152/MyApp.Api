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
        private readonly int _defaultPageSize;

        public DeliveryChallansController(IDeliveryChallanService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        [HttpGet("count")]
        [HasPermission("challans.list.view")]
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            return Ok(await _service.GetTotalCountAsync());
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("challans.list.view")]
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetByCompany(int companyId)
        {
            var challans = await _service.GetDeliveryChallansByCompanyAsync(companyId);
            return Ok(challans);
        }

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("challans.list.view")]
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
            return Ok(challan);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("challans.manage.create")]
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

        /// <summary>
        /// Clone a Pending/Imported challan as a new row reusing the same
        /// ChallanNumber. Used when one delivery covers multiple POs and each
        /// PO needs its own bill. The clone inherits the source's Status
        /// (Imported stays Imported, Pending stays Pending) and is opened in
        /// the edit form so the operator can change PO/items before saving.
        /// Permission is "create" (not "update") because this materialises a
        /// new challan row, not a mutation of the source.
        /// </summary>
        [HttpPost("{id}/duplicate")]
        [HasPermission("challans.manage.create")]
        public async Task<ActionResult<DeliveryChallanDto>> Duplicate(int id)
        {
            try
            {
                var clone = await _service.DuplicateAsync(id);
                if (clone == null) return NotFound();
                return CreatedAtAction(nameof(GetById), new { id = clone.Id }, clone);
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
            var dto = await _service.GetPrintDataAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }
    }
}
