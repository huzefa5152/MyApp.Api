using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
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
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            return Ok(await _service.GetTotalCountAsync());
        }

        [HttpGet("company/{companyId}")]
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetByCompany(int companyId)
        {
            var challans = await _service.GetDeliveryChallansByCompanyAsync(companyId);
            return Ok(challans);
        }

        [HttpGet("company/{companyId}/paged")]
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
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetPendingByCompany(int companyId)
        {
            var challans = await _service.GetPendingChallansByCompanyAsync(companyId);
            return Ok(challans);
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<DeliveryChallanDto>> GetById(int id)
        {
            var challan = await _service.GetByIdAsync(id);
            if (challan == null) return NotFound();
            return Ok(challan);
        }

        [HttpPost("company/{companyId}")]
        public async Task<ActionResult<DeliveryChallanDto>> Create(int companyId, [FromBody] DeliveryChallanDto dto)
        {
            try
            {
                if (dto.ClientId <= 0)
                    return BadRequest(new { error = "Invalid client." });
                if (string.IsNullOrWhiteSpace(dto.PoNumber))
                    return BadRequest(new { error = "PO number is required." });
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
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message });
            }
        }

        [HttpPut("{id}/items")]
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

        [HttpPut("{id}/cancel")]
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
        public async Task<ActionResult<PrintChallanDto>> GetPrintData(int id)
        {
            var dto = await _service.GetPrintDataAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }
    }
}
