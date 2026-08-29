using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Bulk client onboarding: download a sample sheet, upload a filled one,
    /// review what it would do, then create the rows.
    ///
    /// Every endpoint asserts access on the target company, and the company id
    /// is ALWAYS taken from the request — never from a column in the uploaded
    /// file — so a crafted sheet cannot plant clients in another tenant.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/clients/import")]
    public class ClientImportController : ControllerBase
    {
        private readonly IClientImportService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly AppDbContext _db;
        private readonly ILogger<ClientImportController> _logger;

        /// <summary>
        /// 5 MB. A 200-row customer sheet is a few tens of KB; anything near
        /// this cap is not a customer list.
        /// </summary>
        private const long MaxUploadBytes = 5 * 1024 * 1024;

        private static readonly string[] AllowedExtensions = { ".csv", ".txt", ".tsv", ".xlsx", ".xlsm" };

        public ClientImportController(
            IClientImportService service,
            ICompanyAccessGuard access,
            AppDbContext db,
            ILogger<ClientImportController> logger)
        {
            _service = service;
            _access = access;
            _db = db;
            _logger = logger;
        }

        /// <summary>
        /// The access guard grants the seed admin every company, including ones
        /// that don't exist, so an unknown id would otherwise reach the service
        /// and surface as a per-row "could not be saved" once the FK rejected
        /// it. Answer 404 up front instead.
        /// </summary>
        private Task<bool> CompanyExistsAsync(int companyId)
            => _db.Companies.AsNoTracking().AnyAsync(c => c.Id == companyId);

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>The sample CSV: header row plus two filled example customers.</summary>
        [HttpGet("template")]
        [HasPermission("clients.manage.create")]
        public IActionResult DownloadTemplate()
            => File(_service.BuildTemplateCsv(), "text/csv", "client-import-template.csv");

        /// <summary>
        /// Read the uploaded sheet and report what would happen, row by row.
        /// Writes nothing.
        /// </summary>
        [HttpPost("preview")]
        [HasPermission("clients.manage.create")]
        [RequestSizeLimit(MaxUploadBytes)]
        public async Task<ActionResult<ClientImportPreviewDto>> Preview(
            [FromForm] IFormFile file, [FromQuery] int companyId)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (!await CompanyExistsAsync(companyId))
                return NotFound(new { message = "That company no longer exists." });

            if (file == null || file.Length == 0)
                return BadRequest(new { message = "Choose a file to import." });
            if (file.Length > MaxUploadBytes)
                return BadRequest(new { message = "That file is too large (5 MB maximum)." });

            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (!AllowedExtensions.Contains(ext))
                return BadRequest(new { message = "Upload a .csv or .xlsx file." });

            try
            {
                await using var stream = file.OpenReadStream();
                var preview = await _service.ParseAsync(stream, file.FileName ?? "upload.csv", companyId);
                return Ok(preview);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Client import preview failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The file could not be read. Please check it and try again." });
            }
        }

        /// <summary>Create the confirmed rows.</summary>
        [HttpPost("commit")]
        [HasPermission("clients.manage.create")]
        public async Task<ActionResult<ClientImportResultDto>> Commit([FromBody] ClientImportCommitDto dto)
        {
            if (dto == null || dto.CompanyId <= 0)
                return BadRequest(new { message = "Select a company to import into." });

            // The body carries a companyId, so it is guarded here rather than
            // trusted — the anti-pattern this codebase keeps finding.
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            if (!await CompanyExistsAsync(dto.CompanyId))
                return NotFound(new { message = "That company no longer exists." });

            if (dto.Rows == null || dto.Rows.Count == 0)
                return BadRequest(new { message = "There is nothing to import." });
            if (dto.Rows.Count > Services.Implementations.ClientImportService.MaxRows)
                return BadRequest(new { message = "Too many rows in one import. Split the file and try again." });

            try
            {
                return Ok(await _service.CommitAsync(dto));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Client import commit failed for company {CompanyId}", dto.CompanyId);
                return StatusCode(500, new { message = "The import could not be completed. Please try again." });
            }
        }
    }
}
