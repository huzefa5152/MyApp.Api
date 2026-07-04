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
    public class AttachmentsController : ControllerBase
    {
        private readonly IAttachmentService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly ILogger<AttachmentsController> _logger;

        public AttachmentsController(IAttachmentService service, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, ILogger<AttachmentsController> logger)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Multipart upload. The 30 MB request cap leaves headroom over the
        // 25 MB per-file content cap enforced by AttachmentFileValidator.
        [HttpPost("company/{companyId}")]
        [HasPermission("attachments.manage.upload")]
        [AuthorizeCompany]
        [RequestSizeLimit(30 * 1024 * 1024)]
        public async Task<ActionResult<AttachmentDto>> Upload(
            int companyId,
            IFormFile file,
            [FromForm] int? folderId = null,
            [FromForm] string? entityType = null,
            [FromForm] int? entityId = null)
        {
            try
            {
                var dto = await _service.UploadAsync(companyId, file, folderId, entityType, entityId, CurrentUserId);
                return Ok(dto);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            // Division guard fires inside the service — let the middleware map
            // it to 403 rather than the catch-all turning it into a 500.
            catch (UnauthorizedAccessException) { throw; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Upload attachment failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not upload the file. Please try again." });
            }
        }

        [HttpGet("company/{companyId}/folder/{folderId}")]
        [HasPermission("attachments.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AttachmentDto>>> GetByFolder(int companyId, int folderId)
            => Ok(await _service.GetByFolderAsync(companyId, folderId,
                await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId)));

        // The always-present "Uncategorized" bucket — attachments not filed in
        // any folder (FolderId == null). Used by the Folders library's permanent
        // Uncategorized card.
        [HttpGet("company/{companyId}/uncategorized")]
        [HasPermission("attachments.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AttachmentDto>>> GetUncategorized(int companyId)
            => Ok(await _service.GetUncategorizedAsync(companyId,
                await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId)));

        [HttpGet("company/{companyId}/entity/{entityType}/{entityId}")]
        [HasPermission("attachments.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<AttachmentDto>>> GetByEntity(int companyId, string entityType, int entityId)
            => Ok(await _service.GetByEntityAsync(companyId, entityType, entityId,
                await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId)));

        // Batch attachment counts for a set of entity ids — powers list-card
        // badges (e.g. the Sales Quote list) without N round-trips. Separate
        // path segment ("entity-counts") so it never collides with the
        // {entityType}/{entityId} route above.
        [HttpGet("company/{companyId}/entity-counts/{entityType}")]
        [HasPermission("attachments.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<Dictionary<int, int>>> GetEntityCounts(
            int companyId, string entityType, [FromQuery] string? ids = null)
        {
            var idList = (ids ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(s => int.TryParse(s, out var n) ? n : 0)
                .Where(n => n > 0)
                .ToList();
            return Ok(await _service.GetCountsByEntityAsync(companyId, entityType, idList,
                await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId)));
        }

        [HttpGet("{id}/download")]
        [HasPermission("attachments.list.view")]
        public async Task<IActionResult> Download(int id)
        {
            // Assert access against the row's own CompanyId (and its linked
            // document's division) before resolving disk.
            var meta = await _service.GetByIdAsync(id);
            if (meta == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, meta.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, meta.CompanyId, meta.DivisionId);

            var dl = await _service.GetForDownloadAsync(id);
            if (dl == null) return NotFound(new { error = "The file is missing on disk." });
            return PhysicalFile(dl.AbsolutePath, dl.ContentType, dl.FileName, enableRangeProcessing: true);
        }

        [HttpDelete("{id}")]
        [HasPermission("attachments.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var meta = await _service.GetByIdAsync(id);
            if (meta == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, meta.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, meta.CompanyId, meta.DivisionId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Delete attachment {AttachmentId} failed", id);
                return StatusCode(500, new { error = "Could not delete the file. Please try again." });
            }
        }
    }
}
