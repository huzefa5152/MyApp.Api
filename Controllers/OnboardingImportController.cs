using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyApp.Api.Helpers.Onboarding;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The onboarding workbook: download a sample, preview an upload (writes
    /// nothing), commit it (re-reads the same file), and download the rows
    /// that cannot import.
    ///
    /// Two gates. <c>onboarding.import.run</c> opens the feature; each sheet
    /// then needs the permission that creates its records, so the import can
    /// never create a customer for someone who could not create one on the
    /// Clients page. A sheet asked for by name that the caller cannot create
    /// is a 403; with no sheets named, the caller gets every sheet they can.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/onboarding-import")]
    public class OnboardingImportController : ControllerBase
    {
        private const long MaxUploadBytes = 10 * 1024 * 1024;
        private const string XlsxMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

        private readonly IOnboardingImportService _import;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;
        private readonly IAuditLogService _audit;
        private readonly ILogger<OnboardingImportController> _logger;

        public OnboardingImportController(
            IOnboardingImportService import,
            ICompanyAccessGuard access,
            IPermissionService permissions,
            IAuditLogService audit,
            ILogger<OnboardingImportController> logger)
        {
            _import = import;
            _access = access;
            _permissions = permissions;
            _audit = audit;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// The sheets this request may touch: the ones asked for (all when none
        /// are), minus those the caller cannot create. Null = a sheet was asked
        /// for by name and the caller lacks its permission.
        /// </summary>
        private async Task<List<string>?> ResolveSheetsAsync(string? requested)
        {
            var asked = OnboardingSchema.ParseSheetList(requested);
            var explicitAsk = !string.IsNullOrWhiteSpace(requested);
            var allowed = new List<string>();
            foreach (var key in asked)
            {
                var sheet = OnboardingSchema.Find(key)!;
                if (await _permissions.HasPermissionAsync(CurrentUserId, sheet.PermissionKey)) allowed.Add(key);
                else if (explicitAsk) return null;
            }
            return allowed;
        }

        private ObjectResult SheetForbidden() => StatusCode(403, new
        {
            message = "You do not have permission to create the records on one of the sheets you chose.",
        });

        private IActionResult? CheckFile(IFormFile? file)
        {
            if (file == null || file.Length == 0) return BadRequest(new { message = "No file uploaded." });
            if (file.Length > MaxUploadBytes) return BadRequest(new { message = "The file is larger than 10 MB." });
            var ext = Path.GetExtension(file.FileName ?? "").ToLowerInvariant();
            if (ext != ".xlsx" && ext != ".xls") return BadRequest(new { message = "Only .xlsx or .xls files are supported." });
            return null;
        }

        [HttpGet("company/{companyId:int}/sample")]
        [HasPermission("onboarding.import.run")]
        [AuthorizeCompany]
        public async Task<IActionResult> Sample(int companyId, [FromQuery] string? sheets)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            var keys = await ResolveSheetsAsync(sheets);
            if (keys == null) return SheetForbidden();
            if (keys.Count == 0) return StatusCode(403, new { message = "You cannot create any of the records this import brings in." });
            try
            {
                var bytes = await _import.BuildSampleAsync(companyId, keys);
                return File(bytes, XlsxMime, "import-data-sample.xlsx");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Onboarding sample failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The sample file could not be built. Please try again." });
            }
        }

        [HttpPost("company/{companyId:int}/preview")]
        [HasPermission("onboarding.import.run")]
        [AuthorizeCompany]
        [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Preview(int companyId, [FromForm] IFormFile? file, [FromForm] string? sheets)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (CheckFile(file) is { } bad) return bad;
            var keys = await ResolveSheetsAsync(sheets);
            if (keys == null) return SheetForbidden();
            try
            {
                await using var stream = file!.OpenReadStream();
                return Ok(await _import.PreviewAsync(stream, file.FileName, companyId, keys));
            }
            catch (OnboardingFileException ex) { return BadRequest(new { message = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Onboarding preview failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The file could not be checked. Please verify it is the sample workbook and try again." });
            }
        }

        [HttpPost("company/{companyId:int}/commit")]
        [HasPermission("onboarding.import.run")]
        [AuthorizeCompany]
        [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Commit(int companyId, [FromForm] IFormFile? file, [FromForm] string? sheets)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (CheckFile(file) is { } bad) return bad;
            var keys = await ResolveSheetsAsync(sheets);
            if (keys == null) return SheetForbidden();
            try
            {
                await using var stream = file!.OpenReadStream();
                var result = await _import.CommitAsync(stream, file.FileName, companyId, keys, User.Identity?.Name);
                await AuditAsync(companyId, string.Join(", ", result.Sheets.Select(s =>
                    $"{s.Title}: {s.Created} created, {s.Skipped} skipped, {s.Failed} failed")));
                return Ok(result);
            }
            catch (OnboardingFileException ex) { return BadRequest(new { message = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Onboarding commit failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The import stopped unexpectedly. Rows already imported are kept; upload the file again to finish the rest." });
            }
        }

        [HttpPost("company/{companyId:int}/fix-list")]
        [HasPermission("onboarding.import.run")]
        [AuthorizeCompany]
        [RequestSizeLimit(MaxUploadBytes + 64 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> FixList(int companyId, [FromForm] IFormFile? file, [FromForm] string? sheets)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (CheckFile(file) is { } bad) return bad;
            var keys = await ResolveSheetsAsync(sheets);
            if (keys == null) return SheetForbidden();
            try
            {
                await using var stream = file!.OpenReadStream();
                var bytes = await _import.BuildFixListAsync(stream, file.FileName, companyId, keys);
                return File(bytes, XlsxMime, "import-data-rows-to-fix.xlsx");
            }
            catch (OnboardingFileException ex) { return BadRequest(new { message = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Onboarding fix list failed for company {CompanyId}", companyId);
                return StatusCode(500, new { message = "The list of rows to fix could not be built. Please try again." });
            }
        }

        // Counts only: the rows carry NTNs, CNICs and phone numbers.
        private async Task AuditAsync(int companyId, string summary)
        {
            try
            {
                await _audit.LogAsync(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Information",
                    UserName = User.Identity?.Name,
                    HttpMethod = Request.Method,
                    RequestPath = Request.Path,
                    StatusCode = 200,
                    ExceptionType = "ONBOARDING_IMPORT",
                    Message = $"Onboarding import into company {companyId}: {summary}",
                    CompanyId = companyId,
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Onboarding import audit write failed for company {CompanyId}", companyId);
            }
        }
    }
}
