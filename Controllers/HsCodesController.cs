using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The HS / PCT code master — reference data, NOT tenant data.
    ///
    /// Nothing here is gated on <c>Company.FbrEnabled</c>. A company with FBR
    /// integration switched off must still be able to import the tariff, search
    /// it, and classify its item types; FbrEnabled decides only whether invoices
    /// are submitted to FBR. That separation is the reason this controller
    /// exists instead of another endpoint under FbrController.
    ///
    /// The rows are installation-wide, so the reads take no companyId and carry
    /// no per-tenant data. The two endpoints that DO accept a companyId
    /// (import, uoms) assert access on it, because it selects which company's
    /// FBR token may be used as a fallback credential.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class HsCodesController : ControllerBase
    {
        private readonly IHsCodeService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<HsCodesController> _logger;

        public HsCodesController(
            IHsCodeService service,
            ICompanyAccessGuard access,
            ILogger<HsCodesController> logger)
        {
            _service = service;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Search the master by code prefix or description. Backs the HS Code
        /// autocomplete on the Item Type form.
        /// </summary>
        [HttpGet]
        [HasPermission("hscodes.list.view")]
        public async Task<ActionResult<List<HsCodeDto>>> Search(
            [FromQuery] string? search, [FromQuery] int take = 50, [FromQuery] bool includeInactive = false)
            => Ok(await _service.SearchAsync(search, take, activeOnly: !includeInactive));

        /// <summary>How many codes the master holds. 0 = the import has never run.</summary>
        [HttpGet("count")]
        [HasPermission("hscodes.list.view")]
        public async Task<ActionResult<object>> Count()
            => Ok(new { count = await _service.CountAsync() });

        [HttpGet("{code}")]
        [HasPermission("hscodes.list.view")]
        public async Task<ActionResult<HsCodeDto>> GetByCode(string code)
        {
            var row = await _service.GetByCodeAsync(code);
            if (row == null) return NotFound();
            return Ok(row);
        }

        /// <summary>
        /// UOMs applicable to one HS code. Answered from the master when known,
        /// so this works with FBR integration off.
        /// </summary>
        [HttpGet("{code}/uoms")]
        [HasPermission("hscodes.list.view")]
        public async Task<ActionResult<List<FbrUOMDto>>> GetUoms(string code, [FromQuery] int? companyId = null)
        {
            // companyId only selects whose FBR token may fill a gap in the master.
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            return Ok(await _service.GetUomsForCodeAsync(code, companyId));
        }

        /// <summary>
        /// Import / re-sync the tariff from FBR. Upsert semantics: existing codes
        /// keep their row, new codes are added. Safe to run as often as the
        /// operator likes — that is the contract the UI advertises.
        /// </summary>
        [HttpPost("import")]
        [HasPermission("hscodes.import.run")]
        public async Task<ActionResult<HsCodeImportResultDto>> Import([FromBody] HsCodeImportRequestDto? dto)
        {
            dto ??= new HsCodeImportRequestDto();
            if (dto.CompanyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId.Value);

            try
            {
                var result = await _service.ImportAsync(dto.CompanyId, dto.CreateItemTypes, CurrentUserId);
                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "HS code import failed for user {UserId}", CurrentUserId);
                return StatusCode(500, new { message = "The HS code import could not be completed. Please try again — nothing was left half-applied." });
            }
        }

        /// <summary>
        /// Masked status of the installation-wide FBR reference token. Never
        /// returns the token itself.
        /// </summary>
        [HttpGet("reference-token")]
        [HasPermission("hscodes.list.view")]
        public async Task<ActionResult<FbrReferenceTokenStatusDto>> GetReferenceToken()
            => Ok(await _service.GetReferenceTokenStatusAsync());

        /// <summary>
        /// Install the reference token. Separate permission from the import
        /// itself: this writes a credential, mirroring how Company.FbrToken has
        /// its own key rather than riding on companies.manage.update.
        /// </summary>
        [HttpPut("reference-token")]
        [HasPermission("hscodes.token.manage")]
        public async Task<IActionResult> SetReferenceToken([FromBody] SetFbrReferenceTokenDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Token))
                return BadRequest(new { message = "Token is required." });

            try
            {
                await _service.SetReferenceTokenAsync(dto.Token, dto.Environment, CurrentUserId);
                // Deliberately returns the masked status, never the token.
                return Ok(await _service.GetReferenceTokenStatusAsync());
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Saving the FBR reference token failed for user {UserId}", CurrentUserId);
                return StatusCode(500, new { message = "The token could not be saved. Please try again." });
            }
        }
    }
}
