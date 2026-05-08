using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    // Thin router around the rule-based parser. Every incoming PDF is
    // fingerprinted and routed to the POFormat an operator onboarded for
    // that layout. If no format matches we return HTTP 404 with a clean
    // "format not saved" payload — the UI then asks the user to fill the
    // challan manually instead of surfacing half-parsed garbage.
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class POImportController : ControllerBase
    {
        // Disk root for the PDF archive — relative to the host
        // ContentRootPath. Resolved via _env.ContentRootPath at request
        // time so deploys with different working dirs all land in the
        // same place: <project root>/Data/uploads/po_imports/.
        private const string ArchiveRelativeRoot = "Data/uploads/po_imports";

        private readonly IPOParserService _parser;
        private readonly IPOFormatRegistry _formatRegistry;
        private readonly IRuleBasedPOParser _ruleParser;
        private readonly AppDbContext _context;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<POImportController> _logger;

        public POImportController(
            IPOParserService parser,
            IPOFormatRegistry formatRegistry,
            IRuleBasedPOParser ruleParser,
            AppDbContext context,
            IWebHostEnvironment env,
            ILogger<POImportController> logger)
        {
            _parser = parser;
            _formatRegistry = formatRegistry;
            _ruleParser = ruleParser;
            _context = context;
            _env = env;
            _logger = logger;
        }

        // Resolve current user id from JWT claims (matches the pattern
        // used by ClientsController / CompaniesController). Returns null
        // when the request is anonymous or the claim is malformed —
        // archive rows are still written, just without UploadedByUserId.
        private int? CurrentUserId()
        {
            var raw = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                   ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(raw, out var id) ? id : (int?)null;
        }

        // Absolute path to the archive root, creating it on first use.
        // We store under <root>/{YYYY}/{MM}/{guid}.pdf so a single year
        // never accumulates more than 12 directories worth of files,
        // which keeps `ls` and the SQL Server backup window manageable.
        private string GetArchiveRoot()
        {
            var path = Path.Combine(_env.ContentRootPath, ArchiveRelativeRoot);
            Directory.CreateDirectory(path);
            return path;
        }

        [HttpPost("parse-pdf")]
        [HasPermission("poformats.import.create")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<IActionResult> ParsePdf(IFormFile file, [FromQuery] int? companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });

            if (!file.ContentType.Contains("pdf", StringComparison.OrdinalIgnoreCase) &&
                !file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { error = "Only PDF files are supported." });

            // Pull the upload into memory once so we can both save the
            // bytes to disk AND re-read them for the parser without paying
            // a second round-trip to whatever stream the framework gave us.
            // Capped by the [RequestSizeLimit] above (10 MB) so this can't
            // blow up the heap.
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            var bytes = ms.ToArray();

            // Best-effort archive BEFORE parsing — if disk is full or the
            // path is unwritable we still want to attempt the parse and
            // give the operator a useful response. Disk path + sha are
            // captured here, parse outcome filled in below after the
            // parser runs (or in the catch).
            var archive = await TryWriteArchiveFileAsync(file.FileName, bytes);
            archive.CompanyId = companyId;
            archive.UploadedByUserId = CurrentUserId();

            var sw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                ms.Position = 0;
                var rawText = _parser.ExtractTextFromPdf(ms);

                if (string.IsNullOrWhiteSpace(rawText))
                {
                    sw.Stop();
                    archive.ParseOutcome = "unreadable";
                    archive.ParseDurationMs = (int)sw.ElapsedMilliseconds;
                    await TryPersistArchiveAsync(archive);
                    return UnprocessableEntity(new ParseMissDto
                    {
                        Reason = "unreadable",
                        Message = "Could not extract text from this PDF — it may be scanned/image-based. Please fill the challan manually.",
                        RawText = "",
                    });
                }

                var (result, outcome) = await RouteParseAsync(rawText, companyId);
                sw.Stop();
                ApplyOutcomeToArchive(archive, outcome, sw.ElapsedMilliseconds);
                await TryPersistArchiveAsync(archive);
                return result;
            }
            catch (Exception ex)
            {
                sw.Stop();
                _logger.LogError(ex, "PO PDF parse failed");
                archive.ParseOutcome = "error";
                archive.ParseDurationMs = (int)sw.ElapsedMilliseconds;
                archive.ErrorMessage = Truncate(ex.Message, 1000);
                await TryPersistArchiveAsync(archive);
                return BadRequest(new { error = $"Failed to process PDF: {ex.Message}" });
            }
        }

        [HttpPost("parse-text")]
        [HasPermission("poformats.import.create")]
        public async Task<IActionResult> ParseText([FromBody] ParseTextRequest request, [FromQuery] int? companyId)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
                return BadRequest(new { error = "No text provided." });

            // No PDF to archive in the text-only path — operator pasted
            // raw text, nothing to retain. Keep this lean and skip the
            // archive write entirely.
            var (result, _) = await RouteParseAsync(request.Text, companyId);
            return result;
        }

        // Outcome metadata returned alongside the IActionResult so the
        // ParsePdf entry-point can stamp the right ParseOutcome on the
        // archive row without re-implementing the routing branch logic.
        private class ParseOutcomeInfo
        {
            public string Outcome { get; set; } = "";  // ok / no-format / rules-empty
            public int? MatchedFormatId { get; set; }
            public int? MatchedFormatVersion { get; set; }
            public int ItemsExtracted { get; set; }
        }

        // Common routing. Finds the onboarded POFormat whose fingerprint
        // matches the incoming PDF text and runs the stored rules against
        // it. No LLM, no generic fallback — operator onboards each client
        // layout once through the Configuration UI.
        private async Task<(IActionResult Result, ParseOutcomeInfo Outcome)> RouteParseAsync(string rawText, int? companyId)
        {
            var match = await _formatRegistry.FindMatchAsync(rawText, companyId);
            // Accept both exact hash matches AND high-confidence fuzzy matches
            // (Jaccard ≥ 0.70, enforced upstream in POFormatRegistry). Fuzzy
            // matches catch the common case where two POs from the same client
            // share all template labels but differ by a single stray `#` in
            // the Remarks section (e.g. "For unit # 1 Lhr..." vs "For QC Depart").
            if (match == null)
            {
                _logger.LogInformation("No PO format matched — returning miss payload");
                return (UnprocessableEntity(new ParseMissDto
                {
                    Reason = "no-format",
                    Message = "No PO format has been saved for this client yet. Go to Configuration → PO Formats, add a format using a sample PDF, and try again. For now please fill the challan details manually.",
                    RawText = rawText,
                }), new ParseOutcomeInfo { Outcome = "no-format" });
            }

            // Resolve the per-tenant Client row that this format should
            // pre-select on the import review screen. Two-step lookup:
            //
            //  1. PREFERRED — POFormat.ClientGroupId. The Common Clients
            //     grouping means a Lotte-format saved by Hakimi automatically
            //     applies in Roshan and FBR-Test-Co too, because all three
            //     tenants' Lotte rows share the same ClientGroupId. We pick
            //     whichever client in the IMPORTING company belongs to that
            //     group.
            //  2. FALLBACK — POFormat.ClientId. Legacy formats (or formats
            //     where the linked client doesn't have a group yet) keep
            //     working via the original direct-FK match.
            //
            // Either way, we ALWAYS filter by the importing companyId so
            // we never leak another tenant's client into this tenant's UI.
            int? matchedClientId = null;
            string? matchedClientName = null;
            if (match.Format.ClientGroupId.HasValue && companyId.HasValue)
            {
                var clientRow = await _context.Clients
                    .Where(c => c.ClientGroupId == match.Format.ClientGroupId.Value
                             && c.CompanyId == companyId.Value)
                    .Select(c => new { c.Id, c.Name })
                    .FirstOrDefaultAsync();
                if (clientRow != null)
                {
                    matchedClientId = clientRow.Id;
                    matchedClientName = clientRow.Name;
                }
            }
            // Fallback A — POFormat.ClientId points to the importing
            // tenant's client directly.
            if (matchedClientId == null && match.Format.ClientId.HasValue)
            {
                var clientRow = await _context.Clients
                    .Where(c => c.Id == match.Format.ClientId.Value
                             && (companyId == null || c.CompanyId == companyId.Value))
                    .Select(c => new { c.Id, c.Name })
                    .FirstOrDefaultAsync();
                if (clientRow != null)
                {
                    matchedClientId = clientRow.Id;
                    matchedClientName = clientRow.Name;
                }
            }

            // Fallback B — POFormat is bound to ClientId in another
            // tenant, but that other-tenant client is part of a Common
            // Client group that ALSO has a member in the importing
            // tenant. Hop through Clients to find the right group.
            // Handles data drift where the format's stored ClientGroupId
            // is stale (e.g. the linked client was re-grouped after the
            // format was saved). companyId is required so we only ever
            // resolve to a client owned by the importing tenant.
            if (matchedClientId == null && match.Format.ClientId.HasValue && companyId.HasValue)
            {
                var ownerGroupId = await _context.Clients
                    .Where(c => c.Id == match.Format.ClientId.Value)
                    .Select(c => c.ClientGroupId)
                    .FirstOrDefaultAsync();
                if (ownerGroupId.HasValue)
                {
                    var clientRow = await _context.Clients
                        .Where(c => c.ClientGroupId == ownerGroupId.Value
                                 && c.CompanyId == companyId.Value)
                        .Select(c => new { c.Id, c.Name })
                        .FirstOrDefaultAsync();
                    if (clientRow != null)
                    {
                        matchedClientId = clientRow.Id;
                        matchedClientName = clientRow.Name;
                    }
                }
            }

            var ruleResult = _ruleParser.Parse(rawText, match.Format);
            if (ruleResult.Items.Count == 0 && string.IsNullOrEmpty(ruleResult.PONumber))
            {
                _logger.LogInformation("Format {Id} matched but rule-set produced empty result", match.Format.Id);
                return (UnprocessableEntity(new ParseMissDto
                {
                    Reason = "rules-empty",
                    Message = $"The PO format '{match.Format.Name}' matched this PDF but didn't produce any fields. The sample or headers may be stale — edit the format in Configuration → PO Formats.",
                    RawText = rawText,
                    MatchedFormatId = match.Format.Id,
                    MatchedFormatName = match.Format.Name,
                    MatchedClientId = matchedClientId,
                    MatchedClientName = matchedClientName,
                }), new ParseOutcomeInfo
                {
                    Outcome = "rules-empty",
                    MatchedFormatId = match.Format.Id,
                    MatchedFormatVersion = match.Format.CurrentVersion,
                });
            }

            ruleResult.MatchedFormatId = match.Format.Id;
            ruleResult.MatchedFormatName = match.Format.Name;
            ruleResult.MatchedFormatVersion = match.Format.CurrentVersion;
            ruleResult.MatchedClientId = matchedClientId;
            ruleResult.MatchedClientName = matchedClientName;
            // Strip internal diagnostic warnings from the response — the UI
            // only cares about the extracted fields now.
            ruleResult.Warnings = new List<string>();
            _logger.LogInformation("Parsed via rule-set: formatId={Id} items={Items}", match.Format.Id, ruleResult.Items.Count);
            return (Ok(ruleResult), new ParseOutcomeInfo
            {
                Outcome = "ok",
                MatchedFormatId = match.Format.Id,
                MatchedFormatVersion = match.Format.CurrentVersion,
                ItemsExtracted = ruleResult.Items.Count,
            });
        }

        [HttpPost("ensure-lookups")]
        [HasPermission("poformats.import.create")]
        public async Task<IActionResult> EnsureLookups([FromBody] EnsureLookupsRequest request)
        {
            var createdItems = new List<string>();
            var createdUnits = new List<string>();

            if (request.Descriptions?.Any() == true)
            {
                var distinct = request.Descriptions
                    .Where(d => !string.IsNullOrWhiteSpace(d))
                    .Select(d => d.Trim())
                    .Distinct()
                    .ToList();

                var existing = await _context.ItemDescriptions
                    .Where(i => distinct.Contains(i.Name))
                    .Select(i => i.Name)
                    .ToListAsync();

                foreach (var desc in distinct.Where(d => !existing.Contains(d)))
                {
                    _context.ItemDescriptions.Add(new ItemDescription { Name = desc });
                    createdItems.Add(desc);
                }
            }

            if (request.Units?.Any() == true)
            {
                var distinct = request.Units
                    .Where(u => !string.IsNullOrWhiteSpace(u))
                    .Select(u => u.Trim())
                    .Distinct()
                    .ToList();

                var existing = await _context.Units
                    .Where(u => distinct.Contains(u.Name))
                    .Select(u => u.Name)
                    .ToListAsync();

                foreach (var unit in distinct.Where(u => !existing.Contains(u)))
                {
                    _context.Units.Add(new Unit { Name = unit });
                    createdUnits.Add(unit);
                }
            }

            try
            {
                await _context.SaveChangesAsync();
            }
            catch (DbUpdateException ex) when (ex.InnerException is SqlException sqlEx && (sqlEx.Number == 2601 || sqlEx.Number == 2627))
            {
                // Race on concurrent inserts — ignore, the row we'd have added already exists.
            }

            return Ok(new { createdItems, createdUnits });
        }

        // ── Archive endpoints ──────────────────────────────────────────
        // Read-only triage surface for "which PDFs is the parser failing
        // on?" Operators with poformats.import.create are NOT auto-granted
        // viewArchive — the archive can contain client-confidential PDFs
        // and should be admin-gated.

        [HttpGet("archives")]
        [HasPermission("poformats.import.viewArchive")]
        public async Task<IActionResult> ListArchives(
            [FromQuery] int? companyId,
            [FromQuery] string? outcome,    // ok / no-format / rules-empty / unreadable / error
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 50)
        {
            if (page < 1) page = 1;
            if (pageSize < 1 || pageSize > 200) pageSize = 50;

            var q = _context.PoImportArchives.AsNoTracking().AsQueryable();
            if (companyId.HasValue) q = q.Where(a => a.CompanyId == companyId.Value);
            if (!string.IsNullOrWhiteSpace(outcome)) q = q.Where(a => a.ParseOutcome == outcome);
            if (from.HasValue) q = q.Where(a => a.UploadedAt >= from.Value);
            if (to.HasValue) q = q.Where(a => a.UploadedAt < to.Value);

            var total = await q.CountAsync();
            var rows = await q
                .OrderByDescending(a => a.UploadedAt)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(a => new
                {
                    a.Id,
                    a.CompanyId,
                    a.UploadedByUserId,
                    a.UploadedAt,
                    a.OriginalFileName,
                    a.FileSizeBytes,
                    a.ContentSha256,
                    a.ParseOutcome,
                    a.MatchedFormatId,
                    a.MatchedFormatVersion,
                    a.ItemsExtracted,
                    a.ParseDurationMs,
                    a.ErrorMessage,
                    a.Notes,
                })
                .ToListAsync();

            return Ok(new { total, page, pageSize, rows });
        }

        [HttpGet("archives/{id:int}/file")]
        [HasPermission("poformats.import.viewArchive")]
        public async Task<IActionResult> DownloadArchiveFile(int id)
        {
            var row = await _context.PoImportArchives.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id);
            if (row == null) return NotFound();

            var abs = Path.Combine(GetArchiveRoot(), row.StoredPath.Replace('/', Path.DirectorySeparatorChar));
            if (!System.IO.File.Exists(abs))
                return NotFound(new { error = "Archived file is missing on disk — the DB row exists but the bytes were removed.", row.StoredPath });

            // Stream from disk so large PDFs don't sit in memory. Original
            // filename so the operator's download keeps a recognisable name.
            var stream = new FileStream(abs, FileMode.Open, FileAccess.Read, FileShare.Read);
            return File(stream, "application/pdf", row.OriginalFileName);
        }

        // ── Archive helpers ─────────────────────────────────────────────
        // Best-effort plumbing — every method swallows + logs failures so
        // a disk or DB hiccup never breaks the operator's parse flow.

        // Save bytes to disk under Data/uploads/po_imports/{YYYY}/{MM}/
        // and return a half-populated PoImportArchive whose disk fields
        // are filled in. Caller fills in CompanyId / User / outcome.
        private async Task<PoImportArchive> TryWriteArchiveFileAsync(string originalFileName, byte[] bytes)
        {
            var now = DateTime.UtcNow;
            var archive = new PoImportArchive
            {
                UploadedAt = now,
                OriginalFileName = Truncate(originalFileName ?? "", 255),
                FileSizeBytes = bytes?.LongLength ?? 0,
            };

            try
            {
                if (bytes == null || bytes.Length == 0) return archive;

                var rel = Path.Combine(now.Year.ToString("0000"), now.Month.ToString("00"));
                var absDir = Path.Combine(GetArchiveRoot(), rel);
                Directory.CreateDirectory(absDir);

                var filename = $"{Guid.NewGuid():N}.pdf";
                var absPath = Path.Combine(absDir, filename);
                await System.IO.File.WriteAllBytesAsync(absPath, bytes);

                archive.StoredPath = Path.Combine(rel, filename).Replace('\\', '/');
                archive.ContentSha256 = ComputeSha256(bytes);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not archive PO PDF to disk — parse continues");
            }

            return archive;
        }

        // Stamp the parse outcome onto the archive row. Defensive — if the
        // routing branch returned a partial outcome, we still record it.
        private static void ApplyOutcomeToArchive(PoImportArchive archive, ParseOutcomeInfo info, long elapsedMs)
        {
            archive.ParseOutcome = info?.Outcome ?? "";
            archive.MatchedFormatId = info?.MatchedFormatId;
            archive.MatchedFormatVersion = info?.MatchedFormatVersion;
            archive.ItemsExtracted = info?.ItemsExtracted ?? 0;
            archive.ParseDurationMs = (int)elapsedMs;
        }

        private async Task TryPersistArchiveAsync(PoImportArchive archive)
        {
            // Only persist if we actually managed to capture SOMETHING —
            // an empty StoredPath + empty outcome means the disk write
            // never happened and the DB row would be useless.
            if (string.IsNullOrEmpty(archive.StoredPath) && string.IsNullOrEmpty(archive.ParseOutcome))
                return;

            try
            {
                _context.PoImportArchives.Add(archive);
                await _context.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not write PoImportArchive row — parse already completed");
            }
        }

        private static string ComputeSha256(byte[] bytes)
        {
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(bytes)).ToLowerInvariant();
        }

        private static string Truncate(string? s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Length <= max ? s : s.Substring(0, max);
        }
    }

    public class EnsureLookupsRequest
    {
        public List<string> Descriptions { get; set; } = new();
        public List<string> Units { get; set; } = new();
    }

    // Returned with HTTP 422 when we couldn't parse the PDF — tells the UI
    // exactly why and whether the raw text is worth showing.
    public class ParseMissDto
    {
        public string Reason { get; set; } = "";       // "no-format", "rules-empty", "unreadable"
        public string Message { get; set; } = "";
        public string RawText { get; set; } = "";
        public int? MatchedFormatId { get; set; }
        public string? MatchedFormatName { get; set; }
        public int? MatchedClientId { get; set; }
        public string? MatchedClientName { get; set; }
    }
}
