using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
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
        private readonly IPOParserService _parser;
        private readonly IPOFormatRegistry _formatRegistry;
        private readonly IRuleBasedPOParser _ruleParser;
        private readonly AppDbContext _context;
        private readonly ILogger<POImportController> _logger;

        public POImportController(
            IPOParserService parser,
            IPOFormatRegistry formatRegistry,
            IRuleBasedPOParser ruleParser,
            AppDbContext context,
            ILogger<POImportController> logger)
        {
            _parser = parser;
            _formatRegistry = formatRegistry;
            _ruleParser = ruleParser;
            _context = context;
            _logger = logger;
        }

        [HttpPost("parse-pdf")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<IActionResult> ParsePdf(IFormFile file, [FromQuery] int? companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });

            if (!file.ContentType.Contains("pdf", StringComparison.OrdinalIgnoreCase) &&
                !file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { error = "Only PDF files are supported." });

            try
            {
                using var stream = file.OpenReadStream();
                var rawText = _parser.ExtractTextFromPdf(stream);

                if (string.IsNullOrWhiteSpace(rawText))
                    return UnprocessableEntity(new ParseMissDto
                    {
                        Reason = "unreadable",
                        Message = "Could not extract text from this PDF — it may be scanned/image-based. Please fill the challan manually.",
                        RawText = "",
                    });

                return await RouteParseAsync(rawText, companyId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "PO PDF parse failed");
                return BadRequest(new { error = $"Failed to process PDF: {ex.Message}" });
            }
        }

        [HttpPost("parse-text")]
        public async Task<IActionResult> ParseText([FromBody] ParseTextRequest request, [FromQuery] int? companyId)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
                return BadRequest(new { error = "No text provided." });

            return await RouteParseAsync(request.Text, companyId);
        }

        // Common routing. Finds the onboarded POFormat whose fingerprint
        // matches the incoming PDF text and runs the stored rules against
        // it. No LLM, no generic fallback — operator onboards each client
        // layout once through the Configuration UI.
        private async Task<IActionResult> RouteParseAsync(string rawText, int? companyId)
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
                return UnprocessableEntity(new ParseMissDto
                {
                    Reason = "no-format",
                    Message = "No PO format has been saved for this client yet. Go to Configuration → PO Formats, add a format using a sample PDF, and try again. For now please fill the challan details manually.",
                    RawText = rawText,
                });
            }

            var ruleResult = _ruleParser.Parse(rawText, match.Format);
            if (ruleResult.Items.Count == 0 && string.IsNullOrEmpty(ruleResult.PONumber))
            {
                _logger.LogInformation("Format {Id} matched but rule-set produced empty result", match.Format.Id);
                return UnprocessableEntity(new ParseMissDto
                {
                    Reason = "rules-empty",
                    Message = $"The PO format '{match.Format.Name}' matched this PDF but didn't produce any fields. The sample or headers may be stale — edit the format in Configuration → PO Formats.",
                    RawText = rawText,
                    MatchedFormatId = match.Format.Id,
                    MatchedFormatName = match.Format.Name,
                });
            }

            ruleResult.MatchedFormatId = match.Format.Id;
            ruleResult.MatchedFormatName = match.Format.Name;
            ruleResult.MatchedFormatVersion = match.Format.CurrentVersion;
            // Strip internal diagnostic warnings from the response — the UI
            // only cares about the extracted fields now.
            ruleResult.Warnings = new List<string>();
            _logger.LogInformation("Parsed via rule-set: formatId={Id} items={Items}", match.Format.Id, ruleResult.Items.Count);
            return Ok(ruleResult);
        }

        [HttpPost("ensure-lookups")]
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
    }
}
