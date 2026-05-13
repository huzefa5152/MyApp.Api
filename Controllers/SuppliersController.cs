using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Mirror of <see cref="ClientsController"/> for the purchase side.
    /// Same shape: list (all + by-company + count), get-by-id, create,
    /// update, delete. Permission keys are <c>suppliers.manage.*</c>.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SuppliersController : ControllerBase
    {
        private readonly ISupplierService _service;
        private readonly ISupplierGroupService _groupService;
        private readonly ICompanyAccessGuard _access;
        public SuppliersController(ISupplierService service, ISupplierGroupService groupService, ICompanyAccessGuard access)
        {
            _service = service;
            _groupService = groupService;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // ── Common Suppliers (cross-company grouping) ──
        // Mirror of /api/clients/common* — same HTTP shape, same
        // permissions family. These are purely additive endpoints; the
        // existing per-company routes above keep their behaviour.

        [HttpGet("common")]
        [HasPermission("suppliers.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<CommonSupplierDto>>> GetCommon([FromQuery] int companyId)
            => Ok(await _groupService.GetCommonSuppliersAsync(companyId));

        [HttpGet("groups")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<List<CommonSupplierDto>>> GetAllGroups()
            => Ok(await _groupService.GetAllGroupsAsync());

        [HttpGet("common/{groupId:int}")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<CommonSupplierDetailDto>> GetCommonById(int groupId)
        {
            var detail = await _groupService.GetByIdAsync(groupId);
            if (detail == null) return NotFound();
            return Ok(detail);
        }

        [HttpPut("common/{groupId:int}")]
        [HasPermission("suppliers.manage.update")]
        public async Task<ActionResult<CommonSupplierUpdateResultDto>> UpdateCommon(
            int groupId, [FromBody] CommonSupplierUpdateDto dto)
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

        [HttpDelete("common/{groupId:int}")]
        [HasPermission("suppliers.manage.delete")]
        public async Task<ActionResult<CommonSupplierUpdateResultDto>> DeleteCommon(int groupId)
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

        [HttpPost("batch")]
        [HasPermission("suppliers.manage.create")]
        public async Task<ActionResult<CreateSupplierBatchResultDto>> CreateBatch([FromBody] CreateSupplierBatchDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (dto.CompanyIds == null || dto.CompanyIds.Count == 0)
                return BadRequest(new { message = "Select at least one company." });

            // Per-id tenant access check — audit H-15 (2026-05-13).
            foreach (var cid in dto.CompanyIds)
                await _access.AssertAccessAsync(CurrentUserId, cid);

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

        [HttpGet]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<IEnumerable<SupplierDto>>> GetSuppliers()
        {
            // Tenant filter: only suppliers of companies the caller can
            // access. Replaces the previous "return everything" behaviour
            // that mixed tenants on a single response.
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var rows = await _service.GetAllAsync();
            return Ok(rows.Where(r => allowed.Contains(r.CompanyId)));
        }

        [HttpGet("count")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<int>> GetCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                var rows = await _service.GetByCompanyAsync(companyId.Value);
                return Ok(rows.Count());
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var all = await _service.GetAllAsync();
            return Ok(all.Count(r => allowed.Contains(r.CompanyId)));
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("suppliers.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<IEnumerable<SupplierDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("{id}")]
        [HasPermission("suppliers.manage.view")]
        public async Task<ActionResult<SupplierDto>> GetById(int id)
        {
            var s = await _service.GetByIdAsync(id);
            if (s == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, s.CompanyId);
            return Ok(s);
        }

        [HttpPost]
        [HasPermission("suppliers.manage.create")]
        public async Task<ActionResult<SupplierDto>> Create([FromBody] SupplierDto dto)
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

        [HttpPut("{id}")]
        [HasPermission("suppliers.manage.update")]
        public async Task<ActionResult<SupplierDto>> Update(int id, [FromBody] SupplierDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            dto.Id = id;
            // Authorize against the existing row's company, not the body —
            // body could be forged to point at a tenant the user owns.
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
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
        [HasPermission("suppliers.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                await _service.DeleteAsync(id);
                return NoContent();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }
    }
}
