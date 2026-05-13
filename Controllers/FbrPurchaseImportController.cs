using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// FBR Annexure-A purchase ledger importer. Phase 1 exposes
    /// /preview only — read-only, no DB writes. The operator uploads
    /// their xls/xlsx and gets back a per-row decision report they
    /// review before clicking Commit (Commit lands in Phase 2).
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/fbr-purchase-import")]
    public class FbrPurchaseImportController : ControllerBase
    {
        private readonly IFbrPurchaseImportService _import;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<FbrPurchaseImportController> _logger;

        public FbrPurchaseImportController(
            IFbrPurchaseImportService import,
            ICompanyAccessGuard access,
            ILogger<FbrPurchaseImportController> logger)
        {
            _import = import;
            _access = access;
            _logger = logger;
        }

        /// <summary>
        /// Multipart upload — file + companyId. Returns the preview
        /// report. No DB writes, completely safe to retry.
        /// </summary>
        [HttpPost("preview")]
        [HasPermission("fbrimport.purchase.preview")]
        // FBR exports for a busy month can run 5-15 MB. Capping at 25 MB
        // gives generous headroom without inviting abuse.
        [RequestSizeLimit(25 * 1024 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Preview(
            [FromForm] IFormFile file,
            [FromForm] int companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });

            if (companyId <= 0)
                return BadRequest(new { error = "companyId is required." });

            // Tenant guard — audit C-3 (2026-05-13): the importer plants
            // Suppliers, PurchaseBills, ItemTypes, and StockMovements into
            // the target company. Pre-fix, any user with the perm could
            // pass a competitor's companyId.
            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();
            await _access.AssertAccessAsync(userId.Value, companyId);

            // Accept both old .xls (HSSF) and new .xlsx (XSSF). FBR's
            // current export is .xls; they're moving to .xlsx in 2026.
            var name = (file.FileName ?? "").ToLowerInvariant();
            if (!name.EndsWith(".xls") && !name.EndsWith(".xlsx"))
                return BadRequest(new { error = "Only .xls or .xlsx files are supported." });

            try
            {
                using var stream = file.OpenReadStream();
                var response = await _import.PreviewAsync(stream, file.FileName!, companyId);
                return Ok(response);
            }
            catch (Exception ex)
            {
                // Audit M-1 (2026-05-08): pre-fix this returned ex.Message
                // verbatim. Now the full exception is in the file sink and
                // AuditLog; the operator gets a generic message.
                _logger.LogError(ex, "FBR purchase preview failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Failed to preview the FBR file. Please verify the file is a valid Annexure-A export and try again." });
            }
        }

        /// <summary>
        /// Commit endpoint — re-parses the file (no preview state passed
        /// in, the file is the input) and writes Suppliers, PurchaseBills,
        /// PurchaseItems, ItemTypes (auto-created), and StockMovements
        /// for every row tagged will-import or product-will-be-created.
        /// Each invoice is committed in its own transaction; one bad
        /// invoice rolls back just itself. Idempotent on retry — the
        /// dedup matcher catches already-imported rows on the 2nd pass
        /// and surfaces them as already-exists / invoices-skipped.
        /// </summary>
        [HttpPost("commit")]
        [HasPermission("fbrimport.purchase.commit")]
        [RequestSizeLimit(25 * 1024 * 1024)]
        [EnableRateLimiting("import")]
        public async Task<IActionResult> Commit(
            [FromForm] IFormFile file,
            [FromForm] int companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });
            if (companyId <= 0)
                return BadRequest(new { error = "companyId is required." });

            // Tenant guard — see Preview for context (audit C-3).
            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();
            await _access.AssertAccessAsync(userId.Value, companyId);

            var name = (file.FileName ?? "").ToLowerInvariant();
            if (!name.EndsWith(".xls") && !name.EndsWith(".xlsx"))
                return BadRequest(new { error = "Only .xls or .xlsx files are supported." });

            try
            {
                using var stream = file.OpenReadStream();
                var response = await _import.CommitAsync(stream, file.FileName!, companyId, userId);
                return Ok(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "FBR purchase commit failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Failed to commit the FBR import. The transaction was rolled back. Please retry; if the failure persists, contact an administrator." });
            }
        }

        private int? CurrentUserId()
        {
            var raw = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                   ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(raw, out var id) ? id : (int?)null;
        }
    }
}
