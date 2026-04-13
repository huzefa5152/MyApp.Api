using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class FbrController : ControllerBase
    {
        private readonly IFbrService _fbrService;

        public FbrController(IFbrService fbrService)
        {
            _fbrService = fbrService;
        }

        // ── Submit & Validate ────────────────────────────────────

        [HttpPost("{invoiceId}/submit")]
        public async Task<IActionResult> SubmitInvoice(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var result = await _fbrService.SubmitInvoiceAsync(invoiceId, scenarioId);
            // Always return 200 — result.Success indicates outcome;
            // FBR details are in our custom audit log, not middleware's generic log
            return Ok(result);
        }

        [HttpPost("{invoiceId}/validate")]
        public async Task<IActionResult> ValidateInvoice(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var result = await _fbrService.ValidateInvoiceAsync(invoiceId, scenarioId);
            return Ok(result);
        }

        // ── Reference Data v1 ───────────────────────────────────

        [HttpGet("provinces/{companyId}")]
        public async Task<IActionResult> GetProvinces(int companyId)
            => Ok(await _fbrService.GetProvincesAsync(companyId));

        [HttpGet("doctypes/{companyId}")]
        public async Task<IActionResult> GetDocTypes(int companyId)
            => Ok(await _fbrService.GetDocTypesAsync(companyId));

        [HttpGet("hscodes/{companyId}")]
        public async Task<IActionResult> GetHSCodes(int companyId, [FromQuery] string? search)
            => Ok(await _fbrService.GetHSCodesAsync(companyId, search));

        [HttpGet("uom/{companyId}")]
        public async Task<IActionResult> GetUOMs(int companyId)
            => Ok(await _fbrService.GetUOMsAsync(companyId));

        [HttpGet("transactiontypes/{companyId}")]
        public async Task<IActionResult> GetTransactionTypes(int companyId)
            => Ok(await _fbrService.GetTransactionTypesAsync(companyId));

        [HttpGet("sroitemcodes/{companyId}")]
        public async Task<IActionResult> GetSROItemCodes(int companyId)
            => Ok(await _fbrService.GetSROItemCodesAsync(companyId));

        // ── Reference Data v2 ───────────────────────────────────

        [HttpGet("saletyperates/{companyId}")]
        public async Task<IActionResult> GetSaleTypeRates(
            int companyId,
            [FromQuery] string date,
            [FromQuery] int transTypeId,
            [FromQuery] int provinceId)
            => Ok(await _fbrService.GetSaleTypeRatesAsync(companyId, date, transTypeId, provinceId));

        [HttpGet("sroschedule/{companyId}")]
        public async Task<IActionResult> GetSROSchedule(
            int companyId,
            [FromQuery] int rateId,
            [FromQuery] string date,
            [FromQuery] int provinceId)
            => Ok(await _fbrService.GetSROScheduleAsync(companyId, rateId, date, provinceId));

        [HttpGet("sroitems/{companyId}")]
        public async Task<IActionResult> GetSROItems(
            int companyId,
            [FromQuery] string date,
            [FromQuery] int sroId)
            => Ok(await _fbrService.GetSROItemsAsync(companyId, date, sroId));

        [HttpGet("hsuom/{companyId}")]
        public async Task<IActionResult> GetHSCodeUOM(
            int companyId,
            [FromQuery] string hsCode,
            [FromQuery] int annexureId)
            => Ok(await _fbrService.GetHSCodeUOMAsync(companyId, hsCode, annexureId));

        // ── STATL / Registration ────────────────────────────────

        [HttpPost("regstatus/{companyId}")]
        public async Task<IActionResult> CheckRegistrationStatus(
            int companyId,
            [FromQuery] string regNo,
            [FromQuery] string date)
        {
            var result = await _fbrService.CheckRegistrationStatusAsync(companyId, regNo, date);
            return result != null ? Ok(result) : BadRequest(new { message = "Could not check registration status." });
        }

        [HttpPost("regtype/{companyId}")]
        public async Task<IActionResult> GetRegistrationType(
            int companyId,
            [FromQuery] string regNo)
        {
            var result = await _fbrService.GetRegistrationTypeAsync(companyId, regNo);
            return result != null ? Ok(result) : BadRequest(new { message = "Could not determine registration type." });
        }
    }
}
