using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class ClientsController : ControllerBase
    {
        private readonly IClientService _service;
        public ClientsController(IClientService service) => _service = service;

        [HttpGet]
        public async Task<ActionResult<IEnumerable<ClientDto>>> GetClients()
            => Ok(await _service.GetAllAsync());

        [HttpGet("count")]
        public async Task<ActionResult<int>> GetCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                var clients = await _service.GetByCompanyAsync(companyId.Value);
                return Ok(clients.Count());
            }
            var all = await _service.GetAllAsync();
            return Ok(all.Count());
        }

        [HttpGet("company/{companyId}")]
        public async Task<ActionResult<IEnumerable<ClientDto>>> GetClientsByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("{id}")]
        public async Task<ActionResult<ClientDto>> GetClient(int id)
        {
            var client = await _service.GetByIdAsync(id);
            if (client == null) return NotFound();
            return Ok(client);
        }

        [HttpPost]
        public async Task<ActionResult<ClientDto>> CreateClient([FromBody] ClientDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            try
            {
                var result = await _service.CreateAsync(dto);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<ClientDto>> UpdateClient(int id, [FromBody] ClientDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            dto.Id = id;
            try
            {
                var result = await _service.UpdateAsync(dto);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { message = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteClient(int id)
        {
            await _service.DeleteAsync(id);
            return NoContent();
        }
    }
}
