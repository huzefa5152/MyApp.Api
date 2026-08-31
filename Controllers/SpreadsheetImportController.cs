using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Upload side of the spreadsheet importer: validate a workbook, recognise
    /// its layout, and keep the record of what has been imported into a company.
    ///
    /// The company id is ALWAYS taken from the request and asserted, never read
    /// from a cell in the uploaded file — a crafted workbook must not be able to
    /// aim itself at another tenant.
    ///
    /// Preview and commit for each kind arrive with their layout strategies;
    /// identify is separate because it has to run before the operator has chosen
    /// a layout, a mapping, or anything else.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/spreadsheet-import")]
    public class SpreadsheetImportController : ControllerBase
    {
        private readonly ISpreadsheetImportService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;
        private readonly AppDbContext _db;
        private readonly ILogger<SpreadsheetImportController> _logger;

        public SpreadsheetImportController(
            ISpreadsheetImportService service,
            ICompanyAccessGuard access,
            IPermissionService permissions,
            AppDbContext db,
            ILogger<SpreadsheetImportController> logger)
        {
            _service = service;
            _access = access;
            _permissions = permissions;
            _db = db;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// The access guard grants the seed admin every company, including ones
        /// that don't exist, so an unknown id would otherwise reach the service
        /// and fail later as an FK error. Answer 404 up front.
        /// </summary>
        private Task<bool> CompanyExistsAsync(int companyId)
            => _db.Companies.AsNoTracking().AnyAsync(c => c.Id == companyId);

        /// <summary>Permission key that gates running an import of this kind.</summary>
        private static string? RunPermissionFor(string kind) => kind switch
        {
            ImportKinds.OpeningStock => "spreadsheetimport.stock.run",
            ImportKinds.CustomerLedger => "spreadsheetimport.ledger.run",
            _ => null,
        };

        [HttpPost("identify")]
        // Static gate: identifying a workbook is matching it against saved
        // layouts, so reading layouts is a genuine prerequisite. The per-KIND
        // run permission is then checked below — an OR over two keys cannot be
        // expressed with the attribute, which ANDs.
        [HasPermission("spreadsheetimport.profiles.view")]
        [RequestSizeLimit(ExcelUploadValidator.MaxBytes)]
        public async Task<ActionResult<ImportIdentifyResultDto>> Identify(
            [FromForm] IFormFile file,
            [FromQuery] int companyId,
            [FromQuery] string kind)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (!await CompanyExistsAsync(companyId))
                return NotFound(new { message = "That company no longer exists." });

            var canonicalKind = ImportKinds.Canonical(kind);
            if (canonicalKind == null)
                return BadRequest(new { message = "Choose what you are importing." });

            var runKey = RunPermissionFor(canonicalKind)!;
            if (!await _permissions.HasPermissionAsync(CurrentUserId, runKey))
                return Forbid();

            var validated = await ExcelUploadValidator.ValidateAsync(file, HttpContext.RequestAborted);
            if (!validated.Ok)
                return BadRequest(new { message = validated.Error });

            try
            {
                var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
                var result = await _service.IdentifyAsync(
                    validated.Bytes, validated.Extension, validated.FileName,
                    validated.Sha256, canonicalKind, companyId, accessible);

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Identify failed for {Kind} import into company {CompanyId}", canonicalKind, companyId);
                return StatusCode(500, new { message = "The file could not be read. Please check it and try again." });
            }
        }

        [HttpGet("runs")]
        [HasPermission("spreadsheetimport.runs.view")]
        public async Task<ActionResult<PagedResult<ImportRunDto>>> Runs(
            [FromQuery] int companyId,
            [FromQuery] string? kind,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _service.GetRunsAsync(companyId, kind, page, pageSize));
        }

        /// <summary>
        /// Sets aside a completed import so its file can be loaded again. The
        /// only path that lets imported history be written over, which is why it
        /// carries its own permission and requires a reason on the record.
        /// </summary>
        [HttpPost("runs/{id}/supersede")]
        [HasPermission("spreadsheetimport.reimport.force")]
        public async Task<ActionResult<ImportRunDto>> Supersede(
            int id, [FromQuery] int companyId, [FromBody] SupersedeImportRunDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            if (dto == null || string.IsNullOrWhiteSpace(dto.Reason))
                return BadRequest(new { message = "Say why this import is being set aside." });

            try
            {
                var run = await _service.SupersedeAsync(id, companyId, dto.Reason, CurrentUserId);
                if (run == null)
                    return NotFound(new { message = "That import does not exist." });

                _logger.LogInformation(
                    "Import run {RunId} superseded in company {CompanyId} by user {UserId}",
                    id, companyId, CurrentUserId);
                return Ok(run);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Superseding import run {RunId} failed", id);
                return StatusCode(500, new { message = "The import could not be set aside. Please try again." });
            }
        }
    }
}
