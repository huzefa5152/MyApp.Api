using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Authorize]
    public class FbrController : ControllerBase
    {
        private readonly IFbrService _fbrService;
        private readonly AppDbContext _db;

        public FbrController(IFbrService fbrService, AppDbContext db)
        {
            _fbrService = fbrService;
            _db = db;
        }

        // ── Scenario catalog ────────────────────────────────────
        //
        // Returns the full FBR scenario catalog (SN001..SN028) so the UI can
        // render a checklist of scenarios the operator wants to test, scoped
        // by their company's BusinessActivity × Sector profile.

        /// <summary>Returns all 28 FBR scenarios with metadata.</summary>
        [HttpGet("scenarios")]
        public IActionResult GetAllScenarios()
            => Ok(TaxScenarios.All.Select(ToDto));

        /// <summary>
        /// Returns the subset of scenarios applicable to the given company's
        /// BusinessActivity × Sector profile. If the company hasn't declared
        /// either, returns all 28 (operator hasn't decided their profile yet
        /// — better to show the full menu than nothing).
        /// </summary>
        [HttpGet("scenarios/applicable/{companyId}")]
        public async Task<IActionResult> GetApplicableScenarios(int companyId)
        {
            var company = await _db.Companies.AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == companyId);
            if (company == null) return NotFound(new { message = "Company not found." });

            var activities = TaxScenarios.SplitCsv(company.FbrBusinessActivity);
            var sectors    = TaxScenarios.SplitCsv(company.FbrSector);

            var matched = TaxScenarios.GetApplicable(activities, sectors);
            return Ok(new
            {
                companyId,
                activities,
                sectors,
                count = matched.Count,
                scenarios = matched.Select(ToDto)
            });
        }

        private static object ToDto(TaxScenarios.Scenario s) => new
        {
            code = s.Code,
            description = s.Description,
            saleType = s.SaleType,
            defaultRate = s.DefaultRate,
            buyerRegistrationType = s.BuyerRegistrationType,
            isThirdSchedule = s.IsThirdSchedule,
            isEndConsumerRetail = s.IsEndConsumerRetail,
            requiresSroReference = s.RequiresSroReference,
            defaultSroScheduleNo = s.DefaultSroScheduleNo,
            defaultSroItemSerialNo = s.DefaultSroItemSerialNo,
            // Applicability is now reverse-derived from the §10 matrix
            // inside TaxScenarios — no longer a per-scenario property.
        };

        // ── Submit & Validate ────────────────────────────────────

        [HttpPost("{invoiceId}/submit")]
        [HasPermission("invoices.fbr.submit")]
        public async Task<IActionResult> SubmitInvoice(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var result = await _fbrService.SubmitInvoiceAsync(invoiceId, scenarioId);
            // Always return 200 — result.Success indicates outcome;
            // FBR details are in our custom audit log, not middleware's generic log
            return Ok(result);
        }

        [HttpPost("{invoiceId}/validate")]
        [HasPermission("invoices.fbr.validate")]
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
        [HasPermission("fbr.config.view")]
        public async Task<IActionResult> CheckRegistrationStatus(
            int companyId,
            [FromQuery] string regNo,
            [FromQuery] string date)
        {
            var result = await _fbrService.CheckRegistrationStatusAsync(companyId, regNo, date);
            return result != null ? Ok(result) : BadRequest(new { message = "Could not check registration status." });
        }

        [HttpPost("regtype/{companyId}")]
        [HasPermission("fbr.config.view")]
        public async Task<IActionResult> GetRegistrationType(
            int companyId,
            [FromQuery] string regNo)
        {
            var result = await _fbrService.GetRegistrationTypeAsync(companyId, regNo);
            return result != null ? Ok(result) : BadRequest(new { message = "Could not determine registration type." });
        }
    }
}
