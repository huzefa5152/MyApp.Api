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
    /// Admin-only ETL from the legacy Data_2021 DB into a MyApp company
    /// (design §13). Triple-gated: the accounting.import.run permission, the
    /// LegacyDb connection string being configured, AND a non-Production
    /// environment — a data importer that reads an external DB must never be
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

        [HttpPost("company/{companyId}/masters")]
        [HasPermission("accounting.import.run")]
        [AuthorizeCompany]
        public async Task<IActionResult> ImportMasters(int companyId)
        {
            if (_env.IsProduction())
                return NotFound();  // the importer simply doesn't exist in prod
            if (!_import.IsConfigured)
                return BadRequest(new { error = "Legacy import is not configured on this environment." });

            await _access.AssertAccessAsync(CurrentUserId, companyId);
            try
            {
                var result = await _import.ImportMastersAsync(companyId);
                _logger.LogInformation("Legacy masters import into company {CompanyId}: {@Result}", companyId, result.Created);
                return Ok(result);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Legacy masters import failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Import failed. See server logs." });
            }
        }
    }
}
