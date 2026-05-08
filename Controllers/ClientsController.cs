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
    public class ClientsController : ControllerBase
    {
        private readonly IClientService _service;
        private readonly IClientGroupService _groupService;
        private readonly ICompanyAccessGuard _access;
        public ClientsController(IClientService service, IClientGroupService groupService, ICompanyAccessGuard access)
        {
            _service = service;
            _groupService = groupService;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

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
        [AuthorizeCompany]
        public async Task<ActionResult<List<CommonClientDto>>> GetCommon([FromQuery] int companyId)
            => Ok(await _groupService.GetCommonClientsAsync(companyId));

        /// <summary>
        /// Every client group (multi-company AND single-company). Used
        /// by config screens that pick "one row per legal entity" — PO
        /// Formats being the obvious one. Each card carries CompanyCount
        /// so the UI can still hint "this client lives in N companies".
        /// </summary>
        [HttpGet("groups")]
        public async Task<ActionResult<List<CommonClientDto>>> GetAllGroups()
            => Ok(await _groupService.GetAllGroupsAsync());

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

        /// <summary>
        /// Delete a Common Client across every tenant — removes each
        /// per-company Client row (cascading to its invoices /
        /// challans, same as the per-tenant delete UX) plus the
        /// ClientGroup row itself. Permission gated on
        /// clients.manage.delete; the cascade is identical to what
        /// the per-tenant DELETE /api/clients/{id} already does, so
        /// "common delete" is N parallel per-tenant deletes wrapped
        /// in one operator action.
        /// </summary>
        [HttpDelete("common/{groupId:int}")]
        [HasPermission("clients.manage.delete")]
        public async Task<ActionResult<CommonClientUpdateResultDto>> DeleteCommon(int groupId)
        {
            try
            {
                var result = await _groupService.DeleteAsync(groupId);
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
        {
            // Tenant filter — return only clients of companies the caller
            // can reach. Replaces the earlier "everything across tenants"
            // behaviour. Matches what SuppliersController.GetSuppliers does.
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var rows = await _service.GetAllAsync();
            return Ok(rows.Where(r => allowed.Contains(r.CompanyId)));
        }

        [HttpGet("count")]
        public async Task<ActionResult<int>> GetCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                var clients = await _service.GetByCompanyAsync(companyId.Value);
                return Ok(clients.Count());
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var all = await _service.GetAllAsync();
            return Ok(all.Count(r => allowed.Contains(r.CompanyId)));
        }

        [HttpGet("company/{companyId}")]
        [AuthorizeCompany]
        public async Task<ActionResult<IEnumerable<ClientDto>>> GetClientsByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("{id}")]
        public async Task<ActionResult<ClientDto>> GetClient(int id)
        {
            var client = await _service.GetByIdAsync(id);
            if (client == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, client.CompanyId);
            return Ok(client);
        }

        [HttpPost]
        [HasPermission("clients.manage.create")]
        public async Task<ActionResult<ClientDto>> CreateClient([FromBody] ClientDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
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

        /// <summary>
        /// Multi-company create — one form submission, N Client rows
        /// (one per selected CompanyId). Selecting 2+ companies auto-
        /// links the rows into the same ClientGroup so the new client
        /// shows up in the Common Clients panel immediately. Per-company
        /// name collisions are surfaced as skip reasons rather than
        /// failing the whole batch.
        /// </summary>
        [HttpPost("batch")]
        [HasPermission("clients.manage.create")]
        public async Task<ActionResult<CreateClientBatchResultDto>> CreateBatch([FromBody] CreateClientBatchDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (dto.CompanyIds == null || dto.CompanyIds.Count == 0)
                return BadRequest(new { message = "Select at least one company." });

            try
            {
                var result = await _service.CreateForCompaniesAsync(dto);
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

            // Authorize on the existing row's company — body fields can't
            // smuggle the client into another tenant.
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);

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
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _service.DeleteAsync(id);
            return NoContent();
        }
    }
}
