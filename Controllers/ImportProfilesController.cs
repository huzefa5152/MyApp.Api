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
    /// Saved spreadsheet layouts — the mappings that let a workbook the operator
    /// has already described be recognised and imported again without re-mapping.
    ///
    /// Two scopes, and the difference is the whole security story here. A profile
    /// with a CompanyId is private to that tenant and guarded by
    /// <see cref="ICompanyAccessGuard"/> like anything else. A profile WITHOUT
    /// one is installation-wide: visible to every company, so only the seed admin
    /// may create, change or delete it. A tenant user who could write a shared
    /// profile could change how another tenant's imports read their columns.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-profiles")]
    public class ImportProfilesController : ControllerBase
    {
        private readonly IImportProfileService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;
        private readonly ILogger<ImportProfilesController> _logger;

        public ImportProfilesController(
            IImportProfileService service,
            ICompanyAccessGuard access,
            IPermissionService permissions,
            ILogger<ImportProfilesController> logger)
        {
            _service = service;
            _access = access;
            _permissions = permissions;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private string? CurrentUserName =>
            User.FindFirstValue(ClaimTypes.Name) ?? User.Identity?.Name;

        /// <summary>
        /// Guards a write against the profile's OWN scope. Shared profiles are
        /// seed-admin only; private ones go through the tenant guard on the
        /// company that actually owns the row — never on a company id from the
        /// request body.
        /// </summary>
        private async Task<ActionResult?> GuardScopeAsync(int? ownerCompanyId)
        {
            if (ownerCompanyId == null)
            {
                if (!_permissions.IsSeedAdmin(CurrentUserId))
                    return Forbid();
                return null;
            }

            await _access.AssertAccessAsync(CurrentUserId, ownerCompanyId.Value);
            return null;
        }

        [HttpGet]
        [HasPermission("spreadsheetimport.profiles.view")]
        public async Task<ActionResult<List<ImportProfileDto>>> List(
            [FromQuery] string? kind, [FromQuery] int? companyId)
        {
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);

            var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(await _service.ListAsync(kind, companyId, accessible));
        }

        [HttpGet("{id}")]
        [HasPermission("spreadsheetimport.profiles.view")]
        public async Task<ActionResult<ImportProfileDto>> Get(int id)
        {
            var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            // 404 rather than 403 for a layout in another tenant — a distinct
            // status would confirm the row exists.
            if (!await _service.CanAccessAsync(id, accessible))
                return NotFound(new { message = "That layout does not exist." });

            var dto = await _service.GetAsync(id);
            return dto == null ? NotFound(new { message = "That layout does not exist." }) : Ok(dto);
        }

        [HttpGet("{id}/versions")]
        [HasPermission("spreadsheetimport.profiles.view")]
        public async Task<ActionResult<List<ImportProfileVersionDto>>> Versions(int id)
        {
            var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            if (!await _service.CanAccessAsync(id, accessible))
                return NotFound(new { message = "That layout does not exist." });

            return Ok(await _service.GetVersionsAsync(id));
        }

        [HttpPost]
        [HasPermission("spreadsheetimport.profiles.manage")]
        public async Task<ActionResult<ImportProfileDto>> Create([FromBody] CreateImportProfileDto dto)
        {
            if (dto == null) return BadRequest(new { message = "Nothing to save." });

            var guard = await GuardScopeAsync(dto.CompanyId);
            if (guard != null) return guard;

            try
            {
                var created = await _service.CreateAsync(dto, CurrentUserName);
                return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Saving an import layout failed for company {CompanyId}", dto.CompanyId);
                return StatusCode(500, new { message = "The layout could not be saved. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("spreadsheetimport.profiles.manage")]
        public async Task<ActionResult<ImportProfileDto>> Update(int id, [FromBody] UpdateImportProfileDto dto)
        {
            if (dto == null) return BadRequest(new { message = "Nothing to update." });

            // Scope comes from the STORED row, never the body — a forged
            // companyId must not be able to re-point someone else's layout.
            var owner = await _service.GetOwnerAsync(id);
            if (!owner.Found) return NotFound(new { message = "That layout does not exist." });

            var guard = await GuardScopeAsync(owner.CompanyId);
            if (guard != null) return guard;

            try
            {
                var updated = await _service.UpdateAsync(id, dto, CurrentUserName);
                return updated == null
                    ? NotFound(new { message = "That layout does not exist." })
                    : Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Updating import layout {ProfileId} failed", id);
                return StatusCode(500, new { message = "The layout could not be updated. Please try again." });
            }
        }

        [HttpPost("{id}/rollback")]
        [HasPermission("spreadsheetimport.profiles.manage")]
        public async Task<ActionResult<ImportProfileDto>> Rollback(
            int id, [FromBody] RollbackImportProfileDto dto)
        {
            if (dto == null || dto.Version <= 0)
                return BadRequest(new { message = "Choose a version to restore." });

            var owner = await _service.GetOwnerAsync(id);
            if (!owner.Found) return NotFound(new { message = "That layout does not exist." });

            var guard = await GuardScopeAsync(owner.CompanyId);
            if (guard != null) return guard;

            try
            {
                var restored = await _service.RollbackAsync(id, dto, CurrentUserName);
                return restored == null
                    ? NotFound(new { message = "That layout does not exist." })
                    : Ok(restored);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Rolling back import layout {ProfileId} failed", id);
                return StatusCode(500, new { message = "The layout could not be restored. Please try again." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("spreadsheetimport.profiles.manage")]
        public async Task<IActionResult> Delete(int id)
        {
            var owner = await _service.GetOwnerAsync(id);
            if (!owner.Found) return NotFound(new { message = "That layout does not exist." });

            var guard = await GuardScopeAsync(owner.CompanyId);
            if (guard != null) return guard;

            try
            {
                return await _service.DeleteAsync(id)
                    ? NoContent()
                    : NotFound(new { message = "That layout does not exist." });
            }
            catch (InvalidOperationException ex)
            {
                // Refusing to delete a built-in is an answer, not a fault.
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Deleting import layout {ProfileId} failed", id);
                return StatusCode(500, new { message = "The layout could not be deleted. Please try again." });
            }
        }
    }
}
