using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ClientsController : ControllerBase
    {
        private readonly IClientService _service;
        public ClientsController(IClientService service) => _service = service;

        [HttpGet]
        public async Task<ActionResult<IEnumerable<ClientDto>>> GetClients()
            => Ok(await _service.GetAllAsync());

        [HttpGet("{id}")]
        public async Task<ActionResult<ClientDto>> GetClient(int id)
        {
            var client = await _service.GetByIdAsync(id);
            if (client == null) return NotFound();
            return Ok(client);
        }

        [HttpPost]
        public async Task<ActionResult<ClientDto>> SaveClient([FromBody] ClientDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);

            try
            {
                ClientDto result;
                if (dto.Id.HasValue && dto.Id > 0)
                    result = await _service.UpdateAsync(dto);  // Update
                else
                    result = await _service.CreateAsync(dto);  // Create

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
