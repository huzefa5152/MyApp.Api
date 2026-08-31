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
        private readonly IImportProfileService _profiles;
        private readonly IOpeningStockImportService _openingStock;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly IPermissionService _permissions;
        private readonly AppDbContext _db;
        private readonly ILogger<SpreadsheetImportController> _logger;

        public SpreadsheetImportController(
            ISpreadsheetImportService service,
            IImportProfileService profiles,
            IOpeningStockImportService openingStock,
            ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess,
            IPermissionService permissions,
            AppDbContext db,
            ILogger<SpreadsheetImportController> logger)
        {
            _service = service;
            _profiles = profiles;
            _openingStock = openingStock;
            _access = access;
            _divisionAccess = divisionAccess;
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

        // ── Opening stock ────────────────────────────────────────────────────

        /// <summary>
        /// Reads the stock sheet and reports what it would do. Writes nothing.
        /// Takes either a saved layout (<paramref name="profileId"/>) or a
        /// mapping being edited on screen (<paramref name="mappingJson"/>) —
        /// the second is what makes the mapping step iterative.
        /// </summary>
        [HttpPost("opening-stock/preview")]
        [HasPermission("spreadsheetimport.stock.run")]
        [RequestSizeLimit(ExcelUploadValidator.MaxBytes)]
        public async Task<ActionResult<OpeningStockPreviewDto>> PreviewOpeningStock(
            [FromForm] IFormFile file,
            [FromQuery] int companyId,
            [FromQuery] int? profileId,
            [FromForm] string? mappingJson)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (!await CompanyExistsAsync(companyId))
                return NotFound(new { message = "That company no longer exists." });

            var validated = await ExcelUploadValidator.ValidateAsync(file, HttpContext.RequestAborted);
            if (!validated.Ok) return BadRequest(new { message = validated.Error });

            var resolved = await ResolveMappingAsync(
                profileId, mappingJson, ImportKinds.OpeningStock, companyId);
            if (resolved.Error != null) return resolved.Error;

            try
            {
                return Ok(await _openingStock.PreviewAsync(
                    validated.Bytes, validated.Extension, validated.FileName, validated.Sha256,
                    resolved.MappingJson!, companyId, resolved.ProfileId, resolved.ProfileVersion));
            }
            catch (InvalidOperationException ex)
            {
                // Mapping problems are the operator's to fix on the mapping
                // screen, so they are echoed rather than swallowed.
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Opening stock preview failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The file could not be read. Please check it and try again." });
            }
        }

        /// <summary>Writes the reviewed rows.</summary>
        [HttpPost("opening-stock/commit")]
        [HasPermission("spreadsheetimport.stock.run")]
        public async Task<ActionResult<OpeningStockCommitResultDto>> CommitOpeningStock(
            [FromBody] OpeningStockCommitDto dto)
        {
            if (dto == null || dto.CompanyId <= 0)
                return BadRequest(new { message = "Choose a company to import into." });

            // Guarded here rather than trusted: the body carries the company id.
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            if (!await CompanyExistsAsync(dto.CompanyId))
                return NotFound(new { message = "That company no longer exists." });

            // Opening balances are company-level inventory state, which a
            // division-restricted user may not write (policy D2) — the same
            // guard the Opening Balances screen applies.
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, null);

            if (dto.Rows == null || dto.Rows.Count == 0)
                return BadRequest(new { message = "There is nothing to import." });
            if (dto.Rows.Count > Services.Implementations.OpeningStockImportService.MaxSourceRows)
                return BadRequest(new { message = "Too many rows in one import. Split the file and try again." });
            if (dto.AsOfDate == default)
                return BadRequest(new { message = "Choose the date these opening quantities are as at." });

            try
            {
                return Ok(await _openingStock.CommitAsync(dto, CurrentUserId));
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Opening stock commit failed for company {CompanyId}", dto.CompanyId);
                return StatusCode(500, new { message = "The import could not be completed. Nothing was changed." });
            }
        }

        /// <summary>
        /// Works out which mapping an import should run with. A saved layout is
        /// resolved and scope-checked; an inline mapping is used as-is so the
        /// mapping screen can preview edits before anything is saved.
        /// </summary>
        private async Task<(string? MappingJson, int? ProfileId, int? ProfileVersion, ActionResult? Error)>
            ResolveMappingAsync(int? profileId, string? mappingJson, string kind, int companyId)
        {
            if (profileId.HasValue)
            {
                var profile = await _profiles.GetAsync(profileId.Value);
                if (profile == null)
                    return (null, null, null, NotFound(new { message = "That layout does not exist." }));

                // Usable by THIS company: its own, or installation-wide.
                if (profile.CompanyId != null && profile.CompanyId != companyId)
                    return (null, null, null, NotFound(new { message = "That layout does not exist." }));

                if (!string.Equals(profile.Kind, kind, StringComparison.OrdinalIgnoreCase))
                    return (null, null, null, BadRequest(new { message = "That layout is for a different kind of import." }));

                return (profile.MappingJson, profile.Id, profile.CurrentVersion, null);
            }

            if (string.IsNullOrWhiteSpace(mappingJson))
                return (null, null, null, BadRequest(new { message = "Choose a saved layout, or map the columns." }));

            return (mappingJson, null, null, null);
        }

        // ── History ──────────────────────────────────────────────────────────

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
