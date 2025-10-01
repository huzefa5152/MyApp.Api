using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DeliveryChallansController : ControllerBase
    {
        private readonly IDeliveryChallanService _service;

        public DeliveryChallansController(IDeliveryChallanService service)
        {
            _service = service;
        }

        // GET: api/DeliveryChallans/company/1
        [HttpGet("company/{companyId}")]
        public async Task<ActionResult<List<DeliveryChallanDto>>> GetByCompany(int companyId)
        {
            var challans = await _service.GetDeliveryChallansByCompanyAsync(companyId);

            // Always return OK with an empty list if none found
            return Ok(challans);
        }

        // POST: api/DeliveryChallans/company/1
        [HttpPost("company/{companyId}")]
        public async Task<ActionResult<DeliveryChallanDto>> Create(int companyId, [FromBody] DeliveryChallanDto dto)
        {
            try
            {
                // Validate main fields
                // Validate client
                if (dto.ClientId <= 0)
                    return BadRequest(new { error = "Invalid client." });

                if (string.IsNullOrWhiteSpace(dto.PoNumber))
                    return BadRequest(new { error = "PO number is required." });

                if (!dto.DeliveryDate.HasValue)
                    return BadRequest(new { error = "Delivery date is required." });

                // Validate items
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item is required." });

                if (dto.Items.Any(i => string.IsNullOrWhiteSpace(i.Description)))
                    return BadRequest(new { error = "Item descriptions cannot be empty." });

                if (dto.Items.Any(i => i.Quantity <= 0))
                    return BadRequest(new { error = "Item quantity must be greater than zero." });

                var created = await _service.CreateDeliveryChallanAsync(companyId, dto);
                return CreatedAtAction(nameof(GetByCompany), new { companyId }, created);
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message }); // send structured error for unexpected exceptions
            }
        }

    }
}
