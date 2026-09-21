using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
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
        private readonly ICompanyAccessGuard _access;

        private static readonly JsonSerializerOptions JsonOpts = new()
        {
            PropertyNameCaseInsensitive = true,
            WriteIndented = false,
        };

        public POFormatsController(
            IPOFormatRegistry registry,
            IPOFormatFingerprintService fingerprint,
            IPOParserService rawParser,
            AppDbContext db,
            ICompanyAccessGuard access)
        {
            _registry = registry;
            _fingerprint = fingerprint;
            _rawParser = rawParser;
            _db = db;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private async Task AssertOwnerAsync(POFormat format)
        {
            if (format.CompanyId is not int companyId || format.ClientId is not int clientId)
                throw new KeyNotFoundException("PO format not found.");
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            if (!await _db.Clients.AnyAsync(c => c.Id == clientId && c.CompanyId == companyId))
                throw new KeyNotFoundException("PO format not found.");
        }

        private async Task<Client> ValidateClientAsync(int? companyId, int? clientId, int? exceptId = null)
        {
            if (companyId is not > 0 || clientId is not > 0)
                throw new InvalidOperationException("Choose a company and one of its clients.");
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            var client = await _db.Clients.FirstOrDefaultAsync(c => c.Id == clientId && c.CompanyId == companyId);
            if (client == null)
                throw new InvalidOperationException("The client does not belong to the selected company.");
            if (await _db.POFormats.AnyAsync(f => f.CompanyId == companyId && f.ClientId == clientId && f.Id != exceptId))
                throw new InvalidOperationException("A PO format already exists for this client in this company.");
            return client;
        }

        // Minimal picker data uses PO-format permissions, not client administration access.
        [HttpGet("clients")]
        [HasAnyPermission("poformats.manage.create", "poformats.manage.update")]
        public async Task<IActionResult> Clients([FromQuery] int companyId)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _db.Clients.AsNoTracking().Where(c => c.CompanyId == companyId)
                .OrderBy(c => c.Name).Select(c => new { c.Id, c.Name }).ToListAsync());
        }

        // List formats, optionally filtered by companyId and/or clientId.
        [HttpGet]
        [HasPermission("poformats.manage.view")]
        public async Task<ActionResult<List<POFormatListItemDto>>> List([FromQuery] int? companyId, [FromQuery] int? clientId)
        {
            var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            var q = _db.POFormats.AsNoTracking().Include(f => f.Company).Include(f => f.Client)
                .Where(f => f.CompanyId != null && accessible.Contains(f.CompanyId.Value)
                    && f.Client != null && f.Client.CompanyId == f.CompanyId);
            if (companyId.HasValue) q = q.Where(f => f.CompanyId == companyId);
            if (clientId.HasValue) q = q.Where(f => f.ClientId == clientId);

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
                .FirstOrDefaultAsync(x => x.Id == id);
            if (f == null) return NotFound();
            await AssertOwnerAsync(f);
            return Ok(ToDto(f));
        }

        // Upload a sample PDF, get back the extracted raw text + any existing
        // format that matches the fingerprint. The UI uses this during
        // onboarding to show "this layout is already saved as X" before the
        // operator creates a duplicate.
        [HttpPost("fingerprint-pdf")]
        [HasAnyPermission("poformats.manage.create", "poformats.manage.update")]
        [RequestSizeLimit(10 * 1024 * 1024)]
        public async Task<ActionResult<FingerprintPdfResponseDto>> FingerprintPdf(IFormFile file, [FromQuery] int? companyId)
        {
            if (companyId is not > 0)
                return BadRequest(new { error = "Choose a company before uploading a sample." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
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

            var client = await ValidateClientAsync(dto.CompanyId, dto.ClientId);
            dto.ClientGroupId = client.ClientGroupId;

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
            // Description + Quantity are the only required item columns. Unit is
            // optional — many POs have no unit-of-measure column at all.
            if (string.IsNullOrWhiteSpace(dto.DescriptionHeader)
                || string.IsNullOrWhiteSpace(dto.QuantityHeader))
                return BadRequest(new { error = "descriptionHeader and quantityHeader are required." });

            var client = await ValidateClientAsync(dto.CompanyId, dto.ClientId);
            var newClientGroupId = client.ClientGroupId;

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
            // Description + Quantity required; Unit optional (see CreateSimple).
            if (string.IsNullOrWhiteSpace(dto.DescriptionHeader)
                || string.IsNullOrWhiteSpace(dto.QuantityHeader))
                return BadRequest(new { error = "descriptionHeader and quantityHeader are required." });

            await AssertOwnerAsync(format);
            var client = await ValidateClientAsync(format.CompanyId, dto.ClientId, id);
            var newClientGroupId = client.ClientGroupId;

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

            await AssertOwnerAsync(format);

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
            ClientGroupId = null,
            ClientGroupName = null,
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
            ClientGroupId = null,
            ClientGroupName = null,
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
