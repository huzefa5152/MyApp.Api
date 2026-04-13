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
        private readonly AppDbContext _context;

        public POImportController(IPOParserService parser, ILlmPOParserService llmParser, AppDbContext context)
        {
            _parser = parser;
            _llmParser = llmParser;
            _context = context;
        }

        [HttpPost("parse-pdf")]
        [RequestSizeLimit(10 * 1024 * 1024)] // 10 MB
        public async Task<IActionResult> ParsePdf(IFormFile file)
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

                // Step 2: Try LLM parser first (if configured)
                if (_llmParser.IsConfigured)
                {
                    var llmResult = await _llmParser.ParseWithLlmAsync(rawText);
                    if (llmResult != null && (llmResult.Items.Count > 0 || llmResult.PONumber != null))
                        return Ok(llmResult);
                }

                // Step 3: Fall back to position-based PDF parser
                stream.Position = 0;
                var result = _parser.ParsePdf(stream);

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
        public async Task<IActionResult> ParseText([FromBody] ParseTextRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Text))
                return BadRequest(new { error = "No text provided." });

            // Regex first for text paste (user-pasted text is usually well-structured)
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
