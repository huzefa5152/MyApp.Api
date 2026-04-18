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
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class POImportController : ControllerBase
    {
        private readonly IPOParserService _parser;
        private readonly ILlmPOParserService _llmParser;
        private readonly IPOFormatRegistry _formatRegistry;
        private readonly IRuleBasedPOParser _ruleParser;
        private readonly AppDbContext _context;
        private readonly ILogger<POImportController> _logger;

        public POImportController(
            IPOParserService parser,
            ILlmPOParserService llmParser,
            IPOFormatRegistry formatRegistry,
            IRuleBasedPOParser ruleParser,
            AppDbContext context,
            ILogger<POImportController> logger)
        {
            _parser = parser;
            _llmParser = llmParser;
            _formatRegistry = formatRegistry;
            _ruleParser = ruleParser;
            _context = context;
            _logger = logger;
        }

        [HttpPost("parse-pdf")]
        [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
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

                // Step 1: Extract text from PDF (always needed)
                var rawText = _parser.ExtractTextFromPdf(stream);

                if (string.IsNullOrWhiteSpace(rawText))
                    return Ok(new ParsedPODto
                    {
                        RawText = "",
                        Warnings = new List<string> { "Could not extract text from PDF. The file may be scanned/image-based. Please try pasting the text manually." }
                    });

                // Step 2: Rule-based parser (deterministic, no LLM). If the
                // format fingerprint matches a seeded/onboarded POFormat and
                // the rule-set actually produces items, we short-circuit here
                // and never call Gemini — this is the goal of the whole system.
                var match = await _formatRegistry.FindMatchAsync(rawText, companyId);
                if (match != null && match.IsExactMatch)
                {
                    var ruleResult = _ruleParser.Parse(rawText, match.Format);
                    if (ruleResult.Items.Count > 0 || !string.IsNullOrEmpty(ruleResult.PONumber))
                    {
                        ruleResult.MatchedFormatId = match.Format.Id;
                        ruleResult.MatchedFormatName = match.Format.Name;
                        ruleResult.MatchedFormatVersion = match.Format.CurrentVersion;
                        ruleResult.Warnings.Insert(0, $"✓ Parsed using saved format: {match.Format.Name} (v{match.Format.CurrentVersion})");
                        _logger.LogInformation("Parsed via rule-set: formatId={Id} items={Items}", match.Format.Id, ruleResult.Items.Count);
                        return Ok(ruleResult);
                    }
                    _logger.LogInformation("Rule-set for format {Id} matched but produced no output — falling back", match.Format.Id);
                }

                // Step 3: Try LLM parser (Gemini) for unknown formats.
                var llmFailed = false;
                if (_llmParser.IsConfigured)
                {
                    var llmResult = await _llmParser.ParseWithLlmAsync(rawText);
                    if (llmResult != null && (llmResult.Items.Count > 0 || llmResult.PONumber != null))
                    {
                        // If we had a fuzzy (non-exact) format match, surface the suggestion
                        // so the operator can decide whether to onboard this as a new format.
                        if (match != null && !match.IsExactMatch)
                            llmResult.Warnings.Insert(0, $"ℹ This layout resembles '{match.Format.Name}' ({match.Similarity:P0} similar). Consider onboarding it.");
                        return Ok(llmResult);
                    }
                    llmFailed = true;
                }

                // Step 4: Fall back to position-based PDF parser.
                stream.Position = 0;
                var result = _parser.ParsePdf(stream);

                if (llmFailed)
                {
                    result.Warnings.Insert(0,
                        "⚠ AI parser (Gemini) unavailable — likely daily free-tier quota hit. " +
                        "Using basic fallback parser; results may be inaccurate. Please review each " +
                        "field carefully, or try again tomorrow. For reliable high-volume parsing " +
                        "consider upgrading to a paid Gemini API key.");
                }

                if (string.IsNullOrWhiteSpace(result.RawText))
                {
                    result.RawText = rawText;
                    result.Warnings.Add("Could not extract text from PDF. The file may be scanned/image-based. Please try pasting the text manually.");
                }

                return Ok(result);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = $"Failed to process PDF: {ex.Message}" });
            }
        }

        [HttpPost("parse-text")]
        public async Task<IActionResult> ParseText([FromBody] ParseTextRequest request, [FromQuery] int? companyId)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
                return BadRequest(new { error = "No text provided." });

            // Same pipeline as parse-pdf: rule-set first, then LLM, then regex.
            var match = await _formatRegistry.FindMatchAsync(request.Text, companyId);
            if (match != null && match.IsExactMatch)
            {
                var ruleResult = _ruleParser.Parse(request.Text, match.Format);
                if (ruleResult.Items.Count > 0 || !string.IsNullOrEmpty(ruleResult.PONumber))
                {
                    ruleResult.MatchedFormatId = match.Format.Id;
                    ruleResult.MatchedFormatName = match.Format.Name;
                    ruleResult.MatchedFormatVersion = match.Format.CurrentVersion;
                    ruleResult.Warnings.Insert(0, $"✓ Parsed using saved format: {match.Format.Name} (v{match.Format.CurrentVersion})");
                    return Ok(ruleResult);
                }
            }

            // Regex for text paste (user-pasted text is usually well-structured)
            var result = _parser.ParsePO(request.Text);
            if (result.Items.Count > 0)
                return Ok(result);

            // LLM fallback when regex finds no items
            if (_llmParser.IsConfigured)
            {
                var llmResult = await _llmParser.ParseWithLlmAsync(request.Text);
                if (llmResult != null && (llmResult.Items.Count > 0 || llmResult.PONumber != null))
                    return Ok(llmResult);
            }

            return Ok(result);
        }

        [HttpPost("ensure-lookups")]
        public async Task<IActionResult> EnsureLookups([FromBody] EnsureLookupsRequest request)
        {
            var createdItems = new List<string>();
            var createdUnits = new List<string>();

            // Auto-create missing item descriptions
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

            // Auto-create missing units
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
                // Ignore duplicate key errors (race condition)
            }

            return Ok(new { createdItems, createdUnits });
        }
    }

    public class EnsureLookupsRequest
    {
        public List<string> Descriptions { get; set; } = new();
        public List<string> Units { get; set; } = new();
    }
}
