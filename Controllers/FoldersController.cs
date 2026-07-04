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
    public class FoldersController : ControllerBase
    {
        private readonly IFolderService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly int _defaultPageSize;
        private readonly ILogger<FoldersController> _logger;

        public FoldersController(IFolderService service, ICompanyAccessGuard access,
            IConfiguration configuration, ILogger<FoldersController> logger)
        {
            _service = service;
            _access = access;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}")]
        [HasPermission("folders.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<FolderDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("folders.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<FolderDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            return Ok(await _service.GetPagedByCompanyAsync(companyId, clampedPage, size, search));
        }

        [HttpGet("{id}")]
        [HasPermission("folders.list.view")]
        public async Task<ActionResult<FolderDto>> GetById(int id)
        {
            var folder = await _service.GetByIdAsync(id, CurrentUserId);
            if (folder == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, folder.CompanyId);
            return Ok(folder);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("folders.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<FolderDto>> Create(int companyId, [FromBody] CreateFolderDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto, CurrentUserId);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create folder failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not create the folder. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("folders.manage.update")]
        public async Task<ActionResult<FolderDto>> Update(int id, [FromBody] CreateFolderDto dto)
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
        [HasPermission("folders.manage.delete")]
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
            catch (Exception ex)
            {
                _logger.LogError(ex, "Delete folder {FolderId} failed", id);
                return StatusCode(500, new { error = "Could not delete the folder. Please try again." });
            }
        }
    }
}
