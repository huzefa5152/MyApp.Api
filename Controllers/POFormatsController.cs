using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    // PO format authoring surface. Each client's PO layout is onboarded once
    // through the Configuration → PO Formats UI:
    //   1. Operator uploads a sample PDF → we extract text + compute a hash
    //   2. Operator picks the client + fills 5 label/header strings
    //   3. We store a "simple-headers-v1" rule-set keyed on the hash
    // Future PDFs with the same layout route through these rules with no
    // LLM call or regex authoring needed.
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class POFormatsController : ControllerBase
    {
        private readonly IPOFormatRegistry _registry;
        private readonly IPOFormatFingerprintService _fingerprint;
        private readonly IPOParserService _rawParser;
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
            AppDbContext db)
        {
            _registry = registry;
            _fingerprint = fingerprint;
            _rawParser = rawParser;
            _db = db;
        }

        // List formats, optionally filtered by companyId and/or clientId.
        [HttpGet]
        [HasPermission("poformats.manage.view")]
        public async Task<ActionResult<List<POFormatListItemDto>>> List([FromQuery] int? companyId, [FromQuery] int? clientId)
        {
            var q = _db.POFormats
                .AsNoTracking()
                .Include(f => f.Company)
                .Include(f => f.Client)
                .Include(f => f.ClientGroup)
                .AsQueryable();

            if (companyId.HasValue)
                q = q.Where(f => f.CompanyId == companyId.Value || f.CompanyId == null);
            if (clientId.HasValue)
                q = q.Where(f => f.ClientId == clientId.Value);

            var formats = await q.OrderByDescending(f => f.UpdatedAt).ToListAsync();
            return Ok(formats.Select(ToListItemDto).ToList());
        }

        [HttpGet("{id}")]
        [HasPermission("poformats.manage.view")]
        public async Task<ActionResult<POFormatDto>> Get(int id)
        {
            var f = await _db.POFormats
                .AsNoTracking()
                .Include(x => x.Company)
                .Include(x => x.Client)
                .Include(x => x.ClientGroup)
                .FirstOrDefaultAsync(x => x.Id == id);
            if (f == null) return NotFound();
            return Ok(ToDto(f));
        }

        // Upload a sample PDF, get back the extracted raw text + any existing
        // format that matches the fingerprint. The UI uses this during
        // onboarding to show "this layout is already saved as X" before the
        // operator creates a duplicate.
        [HttpPost("fingerprint-pdf")]
        [HasPermission("poformats.manage.create")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<ActionResult<FingerprintPdfResponseDto>> FingerprintPdf(IFormFile file, [FromQuery] int? companyId)
        {
            if (file == null || file.Length == 0)
                return BadRequest(new { error = "No file uploaded." });

            using var stream = file.OpenReadStream();
            var rawText = _rawParser.ExtractTextFromPdf(stream);
            if (string.IsNullOrWhiteSpace(rawText))
                return BadRequest(new { error = "Could not extract text from the PDF. It may be scanned/image-based." });

            var fp = _fingerprint.Compute(rawText);
            var match = await _registry.FindMatchAsync(rawText, companyId);

            return Ok(new FingerprintPdfResponseDto
            {
                RawText = rawText,
                Hash = fp.Hash,
                Keywords = fp.Keywords.ToList(),
                MatchedFormat = match != null ? ToDto(match.Format) : null,
                IsExactMatch = match?.IsExactMatch ?? false,
            });
        }

        // Power-user path: full ruleset JSON. Exposed for the rare case where
        // simple-headers-v1 can't handle a layout (e.g. Lotte Kolson PDFs
        // with a delivery-date column between description and qty). 99% of
        // clients should use /simple instead.
        [HttpPost]
        [HasPermission("poformats.manage.create")]
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

        // Primary onboarding path. Operator gives us 5 label/header strings
        // + the sample PDF's raw text. Server builds a simple-headers-v1
        // rule-set and saves the format.
        [HttpPost("simple")]
        [HasPermission("poformats.manage.create")]
        public async Task<ActionResult<POFormatDto>> CreateSimple([FromBody] POFormatSimpleCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { error = "name is required." });
            if (string.IsNullOrWhiteSpace(dto.RawText))
                return BadRequest(new { error = "rawText is required — upload a sample PDF first." });
            if (string.IsNullOrWhiteSpace(dto.DescriptionHeader)
                || string.IsNullOrWhiteSpace(dto.QuantityHeader)
                || string.IsNullOrWhiteSpace(dto.UnitHeader))
                return BadRequest(new { error = "descriptionHeader, quantityHeader and unitHeader are all required." });

            // Dedup — one format per Common Client GROUP, not per
            // (company, client) pair. Common Clients machinery ensures
            // every Client has a ClientGroupId (single-company clients
            // get a 1-member group). So configuring a format for any
            // tenant's Lotte automatically covers every other tenant's
            // Lotte too — that's the whole point of Phase 3.
            int? newClientGroupId = null;
            if (dto.ClientId.HasValue)
            {
                newClientGroupId = await _db.Clients
                    .Where(c => c.Id == dto.ClientId.Value)
                    .Select(c => c.ClientGroupId)
                    .FirstOrDefaultAsync();

                // Dedup check — prefer ClientGroupId equality so we
                // catch cross-tenant duplicates (Hakimi has a Lotte
                // format, operator on Roshan tries to add another one).
                // Falls back to ClientId equality only when the legacy
                // client somehow doesn't have a group yet.
                var existing = newClientGroupId.HasValue
                    ? await _db.POFormats.FirstOrDefaultAsync(f => f.ClientGroupId == newClientGroupId.Value)
                    : await _db.POFormats.FirstOrDefaultAsync(f => f.CompanyId == dto.CompanyId && f.ClientId == dto.ClientId);
                if (existing != null)
                    return Conflict(new { error = $"A PO format already exists for this client ('{existing.Name}'). Edit it instead of creating a duplicate — every tenant that has this client will use the same format.", existingId = existing.Id });
            }

            var ruleSet = BuildSimpleRuleSet(dto);
            var ruleSetJson = JsonSerializer.Serialize(ruleSet, JsonOpts);

            var createDto = new POFormatCreateDto
            {
                Name = dto.Name,
                CompanyId = dto.CompanyId,
                ClientId = dto.ClientId,
                ClientGroupId = newClientGroupId,
                RawText = dto.RawText,
                RuleSetJson = ruleSetJson,
                Notes = dto.Notes,
            };

            var createdBy = User?.Identity?.Name;
            var format = await _registry.CreateAsync(createDto, createdBy);
            return CreatedAtAction(nameof(Get), new { id = format.Id }, ToDto(format));
        }

        // Edit the 5 fields + metadata in place. If the operator uploads a
        // new sample PDF (RawText is passed), we also recompute the
        // fingerprint hash — useful when the client's template changed.
        [HttpPut("{id}/simple")]
        [HasPermission("poformats.manage.update")]
        public async Task<ActionResult<POFormatDto>> UpdateSimple(int id, [FromBody] POFormatSimpleUpdateDto dto)
        {
            var format = await _db.POFormats.FirstOrDefaultAsync(f => f.Id == id);
            if (format == null) return NotFound();
            if (string.IsNullOrWhiteSpace(dto.DescriptionHeader)
                || string.IsNullOrWhiteSpace(dto.QuantityHeader)
                || string.IsNullOrWhiteSpace(dto.UnitHeader))
                return BadRequest(new { error = "descriptionHeader, quantityHeader and unitHeader are all required." });

            // Dedup on edit — same group-aware check as Create. If the
            // operator re-assigns this format to a client that already
            // has a format saved at the GROUP level (could be in a
            // different tenant), surface a clear conflict.
            int? newClientGroupId = null;
            if (dto.ClientId.HasValue && dto.ClientId != format.ClientId)
            {
                newClientGroupId = await _db.Clients
                    .Where(c => c.Id == dto.ClientId.Value)
                    .Select(c => c.ClientGroupId)
                    .FirstOrDefaultAsync();

                var dupe = newClientGroupId.HasValue
                    ? await _db.POFormats.FirstOrDefaultAsync(f => f.Id != id && f.ClientGroupId == newClientGroupId.Value)
                    : await _db.POFormats.FirstOrDefaultAsync(f => f.Id != id && f.CompanyId == format.CompanyId && f.ClientId == dto.ClientId);
                if (dupe != null)
                    return Conflict(new { error = $"Another PO format already exists for that client ('{dupe.Name}').", existingId = dupe.Id });
            }
            else if (dto.ClientId.HasValue)
            {
                // ClientId unchanged — refresh the group anyway so a
                // newly-grouped client still gets its FK propagated.
                newClientGroupId = await _db.Clients
                    .Where(c => c.Id == dto.ClientId.Value)
                    .Select(c => c.ClientGroupId)
                    .FirstOrDefaultAsync();
            }

            format.Name = dto.Name?.Trim() ?? format.Name;
            format.IsActive = dto.IsActive;
            format.ClientId = dto.ClientId;
            format.ClientGroupId = newClientGroupId;
            format.Notes = dto.Notes;

            // Optional: replace sample text + recompute fingerprint
            if (!string.IsNullOrWhiteSpace(dto.RawText))
            {
                var fp = _fingerprint.Compute(dto.RawText);
                format.SignatureHash = fp.Hash;
                format.KeywordSignature = fp.Signature;
            }

            var ruleSet = BuildSimpleRuleSet(new POFormatSimpleCreateDto
            {
                PoNumberLabel = dto.PoNumberLabel,
                PoDateLabel = dto.PoDateLabel,
                DescriptionHeader = dto.DescriptionHeader,
                QuantityHeader = dto.QuantityHeader,
                UnitHeader = dto.UnitHeader,
            });
            format.RuleSetJson = JsonSerializer.Serialize(ruleSet, JsonOpts);
            format.CurrentVersion += 1;
            format.UpdatedAt = DateTime.UtcNow;

            _db.POFormatVersions.Add(new POFormatVersion
            {
                POFormatId = format.Id,
                Version = format.CurrentVersion,
                RuleSetJson = format.RuleSetJson,
                ChangeNote = "Edited via simple form",
                CreatedBy = User?.Identity?.Name,
                CreatedAt = DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();

            var reloaded = await _db.POFormats
                .AsNoTracking()
                .Include(f => f.Company)
                .Include(f => f.Client)
                .Include(f => f.ClientGroup)
                .FirstAsync(f => f.Id == id);
            return Ok(ToDto(reloaded));
        }

        // Hard delete. The versions and any golden samples cascade via FK
        // config in AppDbContext.
        [HttpDelete("{id}")]
        [HasPermission("poformats.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var format = await _db.POFormats.FirstOrDefaultAsync(f => f.Id == id);
            if (format == null) return NotFound();

            _db.POFormats.Remove(format);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ----- helpers -----

        private static object BuildSimpleRuleSet(POFormatSimpleCreateDto dto) => new
        {
            version = 1,
            engine = "simple-headers-v1",
            poNumberLabel = dto.PoNumberLabel ?? "",
            poDateLabel = dto.PoDateLabel ?? "",
            descriptionHeader = dto.DescriptionHeader,
            quantityHeader = dto.QuantityHeader,
            unitHeader = dto.UnitHeader,
        };

        private static POFormatDto ToDto(POFormat f) => new()
        {
            Id = f.Id,
            Name = f.Name,
            CompanyId = f.CompanyId,
            CompanyName = f.Company?.Name,
            ClientId = f.ClientId,
            ClientName = f.Client?.Name,
            ClientGroupId = f.ClientGroupId,
            ClientGroupName = f.ClientGroup?.DisplayName,
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
            CompanyName = f.Company?.Name,
            ClientId = f.ClientId,
            ClientName = f.Client?.Name,
            ClientGroupId = f.ClientGroupId,
            ClientGroupName = f.ClientGroup?.DisplayName,
            CurrentVersion = f.CurrentVersion,
            IsActive = f.IsActive,
            UpdatedAt = f.UpdatedAt,
        };
    }

    public class FingerprintPdfResponseDto
    {
        public string RawText { get; set; } = "";
        public string Hash { get; set; } = "";
        public List<string> Keywords { get; set; } = new();
        public POFormatDto? MatchedFormat { get; set; }
        public bool IsExactMatch { get; set; }
    }
}
