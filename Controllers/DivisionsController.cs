using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class DivisionsController : ControllerBase
    {
        private readonly IDivisionService _service;
        private readonly ICompanyAccessGuard _access;

        public DivisionsController(IDivisionService service, ICompanyAccessGuard access)
        {
            _service = service;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Divisions are company configuration — reuse the company permission keys
        // (view to read, update to manage) rather than minting a new namespace.
        [HttpGet("company/{companyId}")]
        [HasPermission("companies.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<DivisionDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpPost("company/{companyId}")]
        [HasPermission("companies.manage.update")]
        [AuthorizeCompany]
        public async Task<ActionResult<DivisionDto>> Create(int companyId, [FromBody] DivisionDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetByCompany), new { companyId }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}")]
        [HasPermission("companies.manage.update")]
        public async Task<ActionResult<DivisionDto>> Update(int id, [FromBody] DivisionDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id}")]
        [HasPermission("companies.manage.update")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var ok = await _service.DeleteAsync(id);
            return ok ? NoContent() : NotFound();
        }
    }
}
