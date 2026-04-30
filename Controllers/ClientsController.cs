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
    public class ClientsController : ControllerBase
    {
        private readonly IClientService _service;
        private readonly IClientGroupService _groupService;
        public ClientsController(IClientService service, IClientGroupService groupService)
        {
            _service = service;
            _groupService = groupService;
        }

        // ── Common Clients (shared across companies via grouping) ──
        // Sits under /api/clients/common* so it lives next to the
        // existing client endpoints. Uses the same clients.* permission
        // family because operationally these ARE clients — just viewed
        // through the grouping lens.

        /// <summary>
        /// Multi-company clients visible to companyId. Single-company
        /// clients are excluded — they remain in the per-company list.
        /// </summary>
        [HttpGet("common")]
        public async Task<ActionResult<List<CommonClientDto>>> GetCommon([FromQuery] int companyId)
            => Ok(await _groupService.GetCommonClientsAsync(companyId));

        /// <summary>
        /// Detail view for the Common Client edit form — master fields +
        /// per-company member list (sites stay per-company).
        /// </summary>
        [HttpGet("common/{groupId:int}")]
        public async Task<ActionResult<CommonClientDetailDto>> GetCommonById(int groupId)
        {
            var detail = await _groupService.GetByIdAsync(groupId);
            if (detail == null) return NotFound();
            return Ok(detail);
        }

        /// <summary>
        /// Update master fields and propagate to every sibling Client in
        /// the group. Site fields are intentionally NOT updated here —
        /// each tenant manages its own sites via the per-company form.
        /// </summary>
        [HttpPut("common/{groupId:int}")]
        [HasPermission("clients.manage.update")]
        public async Task<ActionResult<CommonClientUpdateResultDto>> UpdateCommon(
            int groupId, [FromBody] CommonClientUpdateDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            try
            {
                var result = await _groupService.UpdateAsync(groupId, dto);
                return Ok(result);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { message = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

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
        [HasPermission("clients.manage.create")]
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
        [HasPermission("clients.manage.update")]
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
        [HasPermission("clients.manage.delete")]
        public async Task<IActionResult> DeleteClient(int id)
        {
            await _service.DeleteAsync(id);
            return NoContent();
        }
    }
}
