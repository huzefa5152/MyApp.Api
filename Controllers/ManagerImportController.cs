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
        private readonly AttachmentStorage _attachments;
        private readonly ILogger<ManagerImportController> _logger;

        public ManagerImportController(IManagerImportService import, ICompanyAccessGuard access, AttachmentStorage attachments, ILogger<ManagerImportController> logger)
        {
            _import = import;
            _access = access;
            _attachments = attachments;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

        /// <summary>
        /// Upload the export .zip and run the import. multipart/form-data:
        /// file=&lt;zip&gt;, companyName, dryRun (default true), fresh (default false),
        /// perpetual (default false).
        /// <para>
        /// Snapshot (perpetual=false): documents + the trial balance loaded as
        /// chart-of-accounts opening balances, GL posting left OFF.
        /// </para>
        /// <para>
        /// Full General Ledger (perpetual=true): documents + a journal entry per
        /// document + inter-account transfers + a migration true-up, so the Chart
        /// of Accounts matches Manager with GL posting ENABLED. Requires the
        /// trialBalance file AND a "perpetual/" folder in the zip (chart-of-accounts,
        /// bank/BS starting balances, resolved tax codes + non-inventory items).
        /// If companyId is supplied, ONLY the CoA + GL are (re)built on that existing
        /// company (documents untouched) — this is the fix for a company whose GL was
        /// enabled after a snapshot import and no longer matches Manager.
        /// </para>
        /// Returns the per-entity counts + AR/AP reconciliation.
        /// </summary>
        [HttpPost("run")]
        [HasPermission("accounting.import.manager")]
        [DisableRequestSizeLimit]
        public async Task<IActionResult> Run(
            [FromForm] string? companyName = null,
            [FromForm] int? companyId = null,
            [FromForm] bool dryRun = true,
            [FromForm] bool fresh = false,
            [FromForm] bool perpetual = false)
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
            // Perpetual-GL reference data (files under a "perpetual/" folder):
            // chart-of-accounts, bank/BS starting balances, resolved tax codes +
            // non-inventory items. Only consumed when perpetual=true.
            var refDocs = new Dictionary<string, JsonDocument>(StringComparer.OrdinalIgnoreCase);
            // Document-attachment blob bytes (files under an "attachments/" folder),
            // keyed by filename to match the attachments.json manifest "file" refs.
            var attachmentBytes = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
            try
            {
                await using var stream = file.OpenReadStream();
                using var zip = new ZipArchive(stream, ZipArchiveMode.Read);
                foreach (var entry in zip.Entries)
                {
                    if (entry.Length == 0 || string.IsNullOrEmpty(entry.Name)) continue;
                    var path = entry.FullName.Replace('\\', '/');
                    // Attachment blobs live under an "attachments/" folder (any name/ext)
                    // — collect their bytes. The manifest itself (attachments.json) sits
                    // at the export root and is picked up as a summary list below.
                    var isAttBlob = (path.StartsWith("attachments/", StringComparison.OrdinalIgnoreCase)
                                     || path.Contains("/attachments/", StringComparison.OrdinalIgnoreCase))
                                    && !entry.Name.Equals("attachments.json", StringComparison.OrdinalIgnoreCase);
                    if (isAttBlob)
                    {
                        await using var bs = entry.Open();
                        using var ms = new MemoryStream();
                        await bs.CopyToAsync(ms);
                        attachmentBytes[entry.Name] = ms.ToArray();
                        continue;
                    }
                    if (!entry.FullName.EndsWith(".json", StringComparison.OrdinalIgnoreCase)) continue;
                    var name = Path.GetFileNameWithoutExtension(entry.Name);   // e.g. "sales-invoices"
                    // detail files live under a ".../detail/" segment; perpetual-GL
                    // reference data under a ".../perpetual/" segment; everything else
                    // is a summary list.
                    var isDetail = path.Contains("/detail/", StringComparison.OrdinalIgnoreCase)
                                   || path.StartsWith("detail/", StringComparison.OrdinalIgnoreCase);
                    var isRef = path.Contains("/perpetual/", StringComparison.OrdinalIgnoreCase)
                                || path.StartsWith("perpetual/", StringComparison.OrdinalIgnoreCase);
                    JsonDocument doc;
                    await using (var es = entry.Open())
                        doc = await JsonDocument.ParseAsync(es);
                    (isRef ? refDocs : isDetail ? detail : summary)[name] = doc;
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
                // ── Full General Ledger (perpetual) import ────────────────────
                // Documents + a journal entry per document + inter-account transfers
                // + a migration true-up, so the Chart of Accounts matches Manager
                // with GL posting ENABLED. Needs the trial balance + the perpetual/
                // reference data.
                if (perpetual)
                {
                    if (tbText == null)
                        return BadRequest(new { error = "Full-GL import needs the Manager Trial Balance (.txt) — upload it alongside the .zip." });
                    // chart-of-accounts may live under perpetual/ or fall back to the summary list.
                    if (!refDocs.ContainsKey("chart-of-accounts") && summary.TryGetValue("chart-of-accounts", out var coaSum))
                        refDocs["chart-of-accounts"] = coaSum;
                    if (!refDocs.ContainsKey("chart-of-accounts"))
                        return BadRequest(new { error = "Full-GL import needs the 'perpetual/' reference data in the zip (chart-of-accounts, starting balances, resolved tax/non-inventory). Re-export with the perpetual option." });

                    if (companyId is int existId)
                    {
                        // Existing company: its documents are already imported — rebuild
                        // ONLY the CoA + journal entries + true-up (documents untouched).
                        // dryRun rolls back. This fixes a company whose GL was enabled
                        // after a snapshot import and no longer matches Manager.
                        var glOnly = await _import.BuildPerpetualGlAsync(existId, tbText, summary, detail, refDocs, dryRun);
                        _logger.LogInformation("Manager perpetual GL rebuild ({Mode}) on existing company {CompanyId}", dryRun ? "dry-run" : "commit", existId);
                        return Ok(glOnly);
                    }

                    // New company. A true dry-run isn't possible (creating then rolling
                    // back the company leaves nothing for the GL build to post against),
                    // so preview the snapshot + note that the full GL builds on commit.
                    if (dryRun)
                    {
                        var pv = await _import.RunAsync(summary, detail, companyName?.Trim(), null, true, fresh, CurrentUserId, null, null);
                        var tbPv = _import.PreviewTrialBalance(tbText);
                        foreach (var kv in tbPv.Created) pv.Created[kv.Key] = kv.Value;
                        pv.Notes.AddRange(tbPv.Notes);
                        pv.Notes.Add("Full General Ledger (a journal entry per document + inter-account transfers + true-up) will be built on COMMIT — the Chart of Accounts will match Manager with GL posting enabled.");
                        return Ok(pv);
                    }

                    // Commit: import the documents, then build the perpetual GL on top.
                    var attB = attachmentBytes.Count > 0 ? attachmentBytes : null;
                    var docs = await _import.RunAsync(summary, detail, companyName?.Trim(), null, false, fresh, CurrentUserId,
                        attB, attB != null ? _attachments.Root : null);
                    var gl = await _import.BuildPerpetualGlAsync(docs.CompanyId, tbText, summary, detail, refDocs, false);
                    // Surface both the document counts and the GL counts in one report.
                    foreach (var kv in docs.Created) gl.Created.TryAdd(kv.Key, kv.Value);
                    gl.Notes.InsertRange(0, docs.Notes);
                    _logger.LogInformation("Manager perpetual GL import (commit) into new company {CompanyId} \"{Name}\": {@Created}",
                        gl.CompanyId, gl.CompanyName, gl.Created);
                    return Ok(gl);
                }

                // ── Snapshot import (documents + trial-balance opening balances) ──
                // Attachments only apply on a commit (dry-run has no company to file
                // them against, and rolls back). Blobs land in the app's data/attachments.
                var attBytes = (!dryRun && attachmentBytes.Count > 0) ? attachmentBytes : null;
                var report = await _import.RunAsync(summary, detail, companyName?.Trim(), companyId, dryRun, fresh, CurrentUserId,
                    attBytes, attBytes != null ? _attachments.Root : null);

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
                        if (summary.TryGetValue("bank-and-cash-accounts", out var bc) && bc.RootElement.ValueKind == JsonValueKind.Array)
                            report.Notes.Add($"{bc.RootElement.GetArrayLength()} bank/cash account(s) will be split out of the rolled-up cash line and flagged BankCash (populates the receipt/payment dropdown).");
                    }
                    else
                    {
                        // Pass the summary docs so the TB import can split Manager's
                        // rolled-up cash line into the individual bank/cash accounts.
                        var tb = await _import.ImportTrialBalanceAsync(report.CompanyId, tbText, false, summary);
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
                foreach (var d in refDocs.Values) d.Dispose();
            }
        }
    }
}
