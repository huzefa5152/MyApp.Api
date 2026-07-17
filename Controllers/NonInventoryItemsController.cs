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
    /// Per-company Non-Inventory Items (GL-account shortcut line items like
    /// Freight / Discount). Every endpoint asserts tenant access; account links
    /// are validated against the same company in the service.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class NonInventoryItemsController : ControllerBase
    {
        private readonly INonInventoryItemService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<NonInventoryItemsController> _logger;

        public NonInventoryItemsController(
            INonInventoryItemService service,
            ICompanyAccessGuard access,
            ILogger<NonInventoryItemsController> logger)
        {
            _service = service;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}")]
        [HasPermission("noninventoryitems.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<NonInventoryItemDto>>> GetByCompany(int companyId, [FromQuery] bool activeOnly = false)
            => Ok(await _service.GetByCompanyAsync(companyId, activeOnly));

        [HttpGet("{id}")]
        [HasPermission("noninventoryitems.list.view")]
        public async Task<ActionResult<NonInventoryItemDto>> GetById(int id)
        {
            var item = await _service.GetByIdAsync(id);
            if (item == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, item.CompanyId);
            return Ok(item);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("noninventoryitems.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<NonInventoryItemDto>> Create(int companyId, [FromBody] NonInventoryItemDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create non-inventory item failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not create the non-inventory item. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("noninventoryitems.manage.update")]
        public async Task<ActionResult<NonInventoryItemDto>> Update(int id, [FromBody] NonInventoryItemDto dto)
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
        [HasPermission("noninventoryitems.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }
    }
}
