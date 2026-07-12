using System.IO.Compression;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Admin ETL that loads an exported Manager.io business (a .zip of the
    /// JSON produced by scripts/techvologix_export.py + pull_details.py) into a
    /// MyApp company. Unlike the legacy .bak importer this runs entirely through
    /// EF against the app's own DbContext, so it works on the LIVE server (where
    /// the DB is only reachable from inside the app) as well as locally. Guarded
    /// by the accounting.import.manager permission (NOT environment-gated). The
    /// import is idempotent per ExternalRef and supports a dry-run.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/manager-import")]
    public class ManagerImportController : ControllerBase
    {
        private readonly IManagerImportService _import;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<ManagerImportController> _logger;

        public ManagerImportController(IManagerImportService import, ICompanyAccessGuard access, ILogger<ManagerImportController> logger)
        {
            _import = import;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

        /// <summary>
        /// Upload the export .zip and run the import. multipart/form-data:
        /// file=&lt;zip&gt;, companyName, dryRun (default true), fresh (default false).
        /// Returns the per-entity counts + AR/AP reconciliation.
        /// </summary>
        [HttpPost("run")]
        [HasPermission("accounting.import.manager")]
        [DisableRequestSizeLimit]
        public async Task<IActionResult> Run(
            [FromForm] string? companyName = null,
            [FromForm] int? companyId = null,
            [FromForm] bool dryRun = true,
            [FromForm] bool fresh = false)
        {
            // Read files explicitly by field name — robust with multiple file
            // parts + form fields (parameter binding of a second IFormFile is
            // unreliable). "file" = the export .zip; "trialBalance" = the .txt.
            var file = Request.Form.Files.GetFile("file");
            var trialBalance = Request.Form.Files.GetFile("trialBalance");

            if (file == null || file.Length == 0) return BadRequest(new { error = "No export .zip uploaded." });
            if (companyId == null && string.IsNullOrWhiteSpace(companyName))
                return BadRequest(new { error = "Choose an existing company (companyId) or enter a new company name." });
            // Tenant guard: importing into an existing company requires access to it.
            if (companyId is int cid) await _access.AssertAccessAsync(CurrentUserId, cid);

            // Optional Manager Trial Balance (tab-separated .txt) → chart-of-accounts
            // opening balances so the balance sheet / P&L match Manager.
            string? tbText = null;
            if (trialBalance is { Length: > 0 })
            {
                using var sr = new StreamReader(trialBalance.OpenReadStream());
                tbText = await sr.ReadToEndAsync();
            }

            var summary = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
            var detail = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
            try
            {
                await using var stream = file.OpenReadStream();
                using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
                foreach (var entry in zip.Entries)
                {
                    if (entry.Length == 0 || !entry.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) continue;
                    var path = entry.FullName.Replace('\\', '/');
                    var name = Path.GetFileNameWithoutExtension(entry.Name);   // e.g. "sales-invoices"
                    // detail files live under a ".../detail/" segment; everything else is a summary list.
                    var isDetail = path.Contains("/detail/", StringComparison.OrdinalIgnoreCase)
                                   || path.StartsWith("detail/", StringComparison.OrdinalIgnoreCase);
                    JsonDocument doc;
                    await using (var es = entry.Open())
                        doc = await JsonDocument.ParseAsync(es);
                    (isDetail ? detail : summary)[name] = doc;
                }
            }
            catch (InvalidDataException)
            {
                return BadRequest(new { error = "The upload is not a valid .zip archive." });
            }
            catch (JsonException ex)
            {
                return BadRequest(new { error = $"A JSON file in the archive is malformed: {ex.Message}" });
            }

            if (detail.Count == 0)
                return BadRequest(new { error = "No detail/*.json found in the archive. Zip the export folder that contains the 'detail' subfolder." });

            try
            {
                var report = await _import.RunAsync(summary, detail, companyName?.Trim(), companyId, dryRun, fresh, CurrentUserId);

                // Then the trial balance → chart-of-accounts opening balances. On a
                // dry-run the document import rolled back (no company to load into),
                // so we only preview the TB reconciliation; on commit we load it
                // into the just-created company and merge the result.
                if (tbText != null)
                {
                    if (dryRun)
                    {
                        var preview = _import.PreviewTrialBalance(tbText);
                        foreach (var kv in preview.Created) report.Created[kv.Key] = kv.Value;
                        report.Notes.AddRange(preview.Notes);
                    }
                    else
                    {
                        var tb = await _import.ImportTrialBalanceAsync(report.CompanyId, tbText, false);
                        foreach (var kv in tb.Created) report.Created[kv.Key] = kv.Value;
                        report.Notes.AddRange(tb.Notes);
                    }
                }

                _logger.LogInformation("Manager import ({Mode}) into company {CompanyId} \"{Name}\": {@Created}",
                    dryRun ? "dry-run" : "commit", report.CompanyId, report.CompanyName, report.Created);
                return Ok(report);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Manager import failed for \"{Name}\"", companyName);
                return StatusCode(500, new { error = "Import failed. See server logs." });
            }
            finally
            {
                foreach (var d in summary.Values) d.Dispose();
                foreach (var d in detail.Values) d.Dispose();
            }
        }
    }
}
