using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
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
    public class POFormatsController : ControllerBase
    {
        private readonly IPOFormatRegistry _registry;
        private readonly IPOFormatFingerprintService _fingerprint;
        private readonly IPOParserService _rawParser;
        private readonly IRegressionService _regression;
        private readonly AppDbContext _db;

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
            WriteIndented = false,
        };

        public POFormatsController(
            IPOFormatRegistry registry,
            IPOFormatFingerprintService fingerprint,
            IPOParserService rawParser,
            IRegressionService regression,
            AppDbContext db)
        {
            _registry = registry;
            _fingerprint = fingerprint;
            _rawParser = rawParser;
            _regression = regression;
            _db = db;
        }

        [HttpGet]
        public async Task<ActionResult<List<POFormatListItemDto>>> List([FromQuery] int? companyId)
        {
            var formats = await _registry.ListAsync(companyId);
            return Ok(formats.Select(ToListItemDto).ToList());
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<POFormatDto>> Get(int id)
        {
            var f = await _registry.GetAsync(id);
            if (f == null) return NotFound();
            return Ok(ToDto(f));
        }

        [HttpGet("{id}/versions")]
        public async Task<ActionResult<List<POFormatVersionDto>>> Versions(int id)
        {
            var versions = await _registry.GetVersionsAsync(id);
            return Ok(versions.Select(ToVersionDto).ToList());
        }

        // Takes either { rawText } or a PDF upload and returns the fingerprint
        // + any format match. The operator UI uses this during onboarding to
        // check "is this format already known?" before starting a rule-authoring
        // session with the LLM.
        [HttpPost("fingerprint")]
        public async Task<ActionResult<FingerprintResponseDto>> Fingerprint([FromBody] FingerprintRequestDto req)
        {
            if (string.IsNullOrWhiteSpace(req.RawText))
                return BadRequest(new { error = "rawText is required." });

            var fp = _fingerprint.Compute(req.RawText);
            var match = await _registry.FindMatchAsync(req.RawText, req.CompanyId);

            return Ok(new FingerprintResponseDto
            {
                Hash = fp.Hash,
                Signature = fp.Signature,
                Keywords = fp.Keywords.ToList(),
                MatchedFormat = match != null ? ToDto(match.Format) : null,
                MatchSimilarity = match?.Similarity,
                IsExactMatch = match?.IsExactMatch ?? false,
            });
        }

        // Convenience endpoint: upload a PDF, extract text server-side, return
        // fingerprint + match. Avoids the caller having to run PdfPig itself.
        [HttpPost("fingerprint-pdf")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<ActionResult<FingerprintResponseDto>> FingerprintPdf(IFormFile file, [FromQuery] int? companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });

            using var stream = file.OpenReadStream();
            var rawText = _rawParser.ExtractTextFromPdf(stream);
            if (string.IsNullOrWhiteSpace(rawText))
                return Ok(new FingerprintResponseDto());

            var fp = _fingerprint.Compute(rawText);
            var match = await _registry.FindMatchAsync(rawText, companyId);

            return Ok(new FingerprintResponseDto
            {
                Hash = fp.Hash,
                Signature = fp.Signature,
                Keywords = fp.Keywords.ToList(),
                MatchedFormat = match != null ? ToDto(match.Format) : null,
                MatchSimilarity = match?.Similarity,
                IsExactMatch = match?.IsExactMatch ?? false,
            });
        }

        [HttpPost]
        public async Task<ActionResult<POFormatDto>> Create([FromBody] POFormatCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.RawText))
                return BadRequest(new { error = "rawText is required to compute the fingerprint." });
            if (string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { error = "name is required." });

            var createdBy = User?.Identity?.Name;
            var format = await _registry.CreateAsync(dto, createdBy);
            return CreatedAtAction(nameof(Get), new { id = format.Id }, ToDto(format));
        }

        // Gated rule update. Regression harness runs against every verified
        // golden sample before the change is committed. If anything regresses
        // OR the candidate rule leaks into another format's samples, the
        // update is refused with HTTP 409 and the full regression report.
        // Pass ?force=true to bypass the gate (dangerous — operator override
        // for bootstrap scenarios where the regression set itself is wrong).
        [HttpPut("{id}/rules")]
        public async Task<ActionResult<object>> UpdateRules(int id, [FromBody] POFormatUpdateRulesDto dto, [FromQuery] bool force = false)
        {
            var updatedBy = User?.Identity?.Name;
            var (format, report) = await _registry.UpdateRulesAsync(id, dto.RuleSetJson, dto.ChangeNote, updatedBy, enforceRegression: !force);

            if (format == null)
            {
                if (report.TotalSamples == 0 && !force)
                    return NotFound();
                return Conflict(new
                {
                    error = "Regression gate refused the rule-set update. Previously-verified samples would regress or the candidate rule leaks into another format.",
                    report
                });
            }

            return Ok(new { format = ToDto(format), report });
        }

        // Manual test — run a candidate rule-set against stored samples or
        // arbitrary text WITHOUT committing. Powers the preview/diff view
        // before the operator clicks "Save".
        [HttpPost("{id}/test")]
        public async Task<ActionResult<RegressionReportDto>> TestRules(int id, [FromBody] TestRuleSetRequestDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.RuleSetJson))
                return BadRequest(new { error = "ruleSetJson is required." });

            var report = await _regression.TestRuleSetAsync(id, dto.RuleSetJson, crossFormatCheck: true);

            if (!string.IsNullOrWhiteSpace(dto.AdditionalRawText))
            {
                var format = await _db.POFormats.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id);
                var dryRun = _regression.DryRun(dto.RuleSetJson, dto.AdditionalRawText, format?.Name ?? $"format#{id}");
                report.Outcomes.AddRange(dryRun.Outcomes);
                report.TotalSamples += dryRun.TotalSamples;
                report.PassedSamples += dryRun.PassedSamples;
            }

            return Ok(report);
        }

        // --- golden samples ---

        [HttpGet("{id}/samples")]
        public async Task<ActionResult<List<POGoldenSampleDto>>> ListSamples(int id)
        {
            var samples = await _db.POGoldenSamples.AsNoTracking()
                .Where(s => s.POFormatId == id)
                .OrderByDescending(s => s.CreatedAt)
                .ToListAsync();
            return Ok(samples.Select(ToSampleDto).ToList());
        }

        // Store a verified extraction example for a format. Subsequent rule
        // changes will be replayed against this to guarantee they don't
        // regress. Status defaults to "verified" — callers can pass the
        // raw text that was parsed + the expected output the operator
        // confirmed was correct.
        [HttpPost("{id}/samples")]
        public async Task<ActionResult<POGoldenSampleDto>> AddSample(int id, [FromBody] POGoldenSampleCreateDto dto)
        {
            var format = await _db.POFormats.FirstOrDefaultAsync(f => f.Id == id);
            if (format == null) return NotFound();
            if (string.IsNullOrWhiteSpace(dto.RawText))
                return BadRequest(new { error = "rawText is required." });
            if (string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { error = "name is required." });

            byte[]? pdfBlob = null;
            if (!string.IsNullOrWhiteSpace(dto.PdfBase64))
            {
                try { pdfBlob = Convert.FromBase64String(dto.PdfBase64); }
                catch { /* ignore malformed — sample is still usable without the PDF */ }
            }

            var sample = new POGoldenSample
            {
                POFormatId = id,
                Name = dto.Name.Trim(),
                OriginalFileName = dto.OriginalFileName,
                RawText = dto.RawText,
                ExpectedJson = JsonSerializer.Serialize(dto.Expected, JsonOpts),
                Notes = dto.Notes,
                PdfBlob = pdfBlob,
                Status = "verified",
                CreatedBy = User?.Identity?.Name,
                CreatedAt = DateTime.UtcNow,
            };
            _db.POGoldenSamples.Add(sample);
            await _db.SaveChangesAsync();

            return CreatedAtAction(nameof(ListSamples), new { id }, ToSampleDto(sample));
        }

        [HttpDelete("samples/{sampleId}")]
        public async Task<IActionResult> DeleteSample(int sampleId)
        {
            var sample = await _db.POGoldenSamples.FirstOrDefaultAsync(s => s.Id == sampleId);
            if (sample == null) return NotFound();
            _db.POGoldenSamples.Remove(sample);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        [HttpPut("{id}")]
        public async Task<ActionResult<POFormatDto>> UpdateMeta(int id, [FromBody] POFormatUpdateMetaDto dto)
        {
            var format = await _registry.UpdateMetaAsync(id, dto);
            if (format == null) return NotFound();
            return Ok(ToDto(format));
        }

        // ----- mappers -----

        private static POFormatDto ToDto(POFormat f) => new()
        {
            Id = f.Id,
            Name = f.Name,
            CompanyId = f.CompanyId,
            SignatureHash = f.SignatureHash,
            KeywordSignature = f.KeywordSignature,
            RuleSetJson = f.RuleSetJson,
            CurrentVersion = f.CurrentVersion,
            IsActive = f.IsActive,
            Notes = f.Notes,
            CreatedAt = f.CreatedAt,
            UpdatedAt = f.UpdatedAt,
        };

        private static POFormatListItemDto ToListItemDto(POFormat f) => new()
        {
            Id = f.Id,
            Name = f.Name,
            CompanyId = f.CompanyId,
            CurrentVersion = f.CurrentVersion,
            IsActive = f.IsActive,
            UpdatedAt = f.UpdatedAt,
        };

        private static POFormatVersionDto ToVersionDto(POFormatVersion v) => new()
        {
            Id = v.Id,
            Version = v.Version,
            RuleSetJson = v.RuleSetJson,
            ChangeNote = v.ChangeNote,
            CreatedBy = v.CreatedBy,
            CreatedAt = v.CreatedAt,
        };

        private static POGoldenSampleDto ToSampleDto(POGoldenSample s)
        {
            ExpectedResultDto expected;
            try
            {
                expected = JsonSerializer.Deserialize<ExpectedResultDto>(s.ExpectedJson, JsonOpts) ?? new ExpectedResultDto();
            }
            catch
            {
                expected = new ExpectedResultDto();
            }

            return new POGoldenSampleDto
            {
                Id = s.Id,
                POFormatId = s.POFormatId,
                Name = s.Name,
                OriginalFileName = s.OriginalFileName,
                RawText = s.RawText,
                Expected = expected,
                Notes = s.Notes,
                Status = s.Status,
                CreatedBy = s.CreatedBy,
                CreatedAt = s.CreatedAt,
            };
        }
    }
}
