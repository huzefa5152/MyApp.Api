using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Admin-only ETL from a legacy Data_2021 <c>.bak</c> into a MyApp company
    /// (design §13). The operator uploads a backup; the API restores it to a
    /// temp DB and the ordered steps migrate from it. Triple-gated: the
    /// accounting.import.run permission, a reachable SQL Server, AND a
    /// non-Production environment — a restore-and-import tool must never be
    /// reachable in prod (CLAUDE.md: production is strict read-only).
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/legacy-import")]
    public class LegacyImportController : ControllerBase
    {
        private readonly ILegacyImportService _import;
        private readonly ICompanyAccessGuard _access;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<LegacyImportController> _logger;

        public LegacyImportController(
            ILegacyImportService import, ICompanyAccessGuard access,
            IWebHostEnvironment env, ILogger<LegacyImportController> logger)
        {
            _import = import;
            _access = access;
            _env = env;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Shared gate for every endpoint here.
        private IActionResult? Gate()
        {
            if (_env.IsProduction()) return NotFound();   // the importer doesn't exist in prod
            if (!_import.IsConfigured)
                return BadRequest(new { error = "No SQL Server is configured for the importer on this environment." });
            return null;
        }

        // ── Backup upload + restore ──────────────────────────────────────────────

        [HttpPost("upload-backup")]
        [HasPermission("accounting.import.run")]
        [DisableRequestSizeLimit]   // backups can be large; dev-only tool
        public async Task<IActionResult> UploadBackup(IFormFile? file)
        {
            var gate = Gate(); if (gate != null) return gate;
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No backup file uploaded." });
            if (!file.FileName.EndsWith(".bak", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { error = "Upload a SQL Server .bak backup file." });

            try
            {
                await using var stream = file.OpenReadStream();
                var summary = await _import.RestoreBackupAsync(stream, file.FileName);
                _logger.LogInformation("Restored legacy backup {File} into {Db}", file.FileName, summary.SourceDb);
                return Ok(summary);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Backup restore failed for {File}", file.FileName);
                return StatusCode(500, new { error = "Restore failed. Check the SQL Server has restore rights and disk space. See server logs." });
            }
        }

        [HttpPost("cleanup")]
        [HasPermission("accounting.import.run")]
        public async Task<IActionResult> Cleanup([FromQuery] string source)
        {
            var gate = Gate(); if (gate != null) return gate;
            try { await _import.CleanupAsync(source); return Ok(new { dropped = source }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Backup cleanup failed for {Source}", source);
                return StatusCode(500, new { error = "Cleanup failed. See server logs." });
            }
        }

        // ── Ordered migration steps (read from the restored temp DB) ─────────────

        [HttpPost("company/{companyId}/masters")]
        [HasPermission("accounting.import.run")]
        [AuthorizeCompany]
        public Task<IActionResult> ImportMasters(int companyId, [FromQuery] string source)
            => RunStep(companyId, "masters", () => _import.ImportMastersAsync(source, companyId));

        [HttpPost("company/{companyId}/documents")]
        [HasPermission("accounting.import.run")]
        [AuthorizeCompany]
        public Task<IActionResult> ImportDocuments(int companyId, [FromQuery] string source)
            => RunStep(companyId, "documents", () => _import.ImportDocumentsAsync(source, companyId));

        [HttpPost("company/{companyId}/receipts-payments")]
        [HasPermission("accounting.import.run")]
        [AuthorizeCompany]
        public Task<IActionResult> ImportReceiptsPayments(int companyId, [FromQuery] string source)
            => RunStep(companyId, "receipts-payments", () => _import.ImportReceiptsPaymentsAsync(source, companyId));

        private async Task<IActionResult> RunStep(int companyId, string step, Func<Task<LegacyImportResult>> run)
        {
            var gate = Gate(); if (gate != null) return gate;
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            try
            {
                var result = await run();
                _logger.LogInformation("Legacy {Step} import into company {CompanyId}: {@Result}", step, companyId, result.Created);
                return Ok(result);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Legacy {Step} import failed for company {CompanyId}", step, companyId);
                return StatusCode(500, new { error = "Import failed. See server logs." });
            }
        }
    }
}
