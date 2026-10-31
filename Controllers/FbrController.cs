using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
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
        private readonly ICompanyAccessGuard _access;
        private readonly ITaxMappingEngine _taxEngine;

        public FbrController(IFbrService fbrService, AppDbContext db, ICompanyAccessGuard access, ITaxMappingEngine taxEngine)
        {
            _fbrService = fbrService;
            _db = db;
            _access = access;
            _taxEngine = taxEngine;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Look up the invoice's company and assert the caller has tenant
        // access to it. Used by every {invoiceId}/* endpoint below.
        private async Task<IActionResult?> AssertAccessForInvoice(int invoiceId)
        {
            var companyId = await _db.Invoices
                .Where(i => i.Id == invoiceId)
                .Select(i => (int?)i.CompanyId)
                .FirstOrDefaultAsync();
            if (companyId == null) return NotFound(new { message = "Invoice not found." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            return null;
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
        [AuthorizeCompany]
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
        [EnableRateLimiting("fbrSubmit")]
        public async Task<IActionResult> SubmitInvoice(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var denied = await AssertAccessForInvoice(invoiceId);
            if (denied != null) return denied;
            var result = await _fbrService.SubmitInvoiceAsync(invoiceId, scenarioId);
            // Always return 200 — result.Success indicates outcome;
            // FBR details are in our custom audit log, not middleware's generic log
            return Ok(result);
        }

        [HttpPost("{invoiceId}/validate")]
        [HasPermission("invoices.fbr.validate")]
        [EnableRateLimiting("fbrSubmit")]
        public async Task<IActionResult> ValidateInvoice(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var denied = await AssertAccessForInvoice(invoiceId);
            if (denied != null) return denied;
            var result = await _fbrService.ValidateInvoiceAsync(invoiceId, scenarioId);
            return Ok(result);
        }

        /// <summary>
        /// Dry-run preview: build the exact JSON we would POST to FBR's
        /// validate endpoint, but don't send anything. Returns the JSON in
        /// the result's Preview field so operators can sanity-check the
        /// grouped items, descriptions, and totals before clicking the
        /// real Validate / Submit button. Pre-validate still runs so
        /// missing fields are caught early.
        /// </summary>
        [HttpGet("{invoiceId}/preview-payload")]
        [HasPermission("invoices.fbr.preview")]
        public async Task<IActionResult> PreviewPayload(
            int invoiceId, [FromQuery] string? scenarioId = null)
        {
            var denied = await AssertAccessForInvoice(invoiceId);
            if (denied != null) return denied;
            var result = await _fbrService.PreviewInvoicePayloadAsync(invoiceId, scenarioId);
            return Ok(result);
        }

        /// <summary>
        /// Admin recovery for a bill locked in a non-resubmittable FBR state —
        /// "Uncertain" (a submit timed out and its FBR outcome is unconfirmed) or
        /// "Submitting" (a submit crashed mid-flight). This is the deliberate valve
        /// for the double-submit guard (incident 2026-08-05). It NEVER contacts FBR:
        /// either it clears the FBR fields so the bill can be submitted again
        /// (mode "retry" — safe only once verified at FBR that no invoice exists),
        /// or it records an IRN the operator confirmed at FBR (mode "recordExisting").
        /// Gated by invoices.fbr.reset (NOT the ordinary submit permission) and audited.
        /// </summary>
        [HttpPost("{invoiceId}/reset-submission")]
        [HasPermission("invoices.fbr.reset")]
        public async Task<IActionResult> ResetSubmission(
            int invoiceId, [FromBody] FbrResetSubmissionRequest request)
        {
            var denied = await AssertAccessForInvoice(invoiceId);
            if (denied != null) return denied;

            if (request == null || string.IsNullOrWhiteSpace(request.Reason))
                return BadRequest(new { message = "A reason is required to reset a bill's FBR state." });

            var actor = User.Identity?.Name;
            var result = await _fbrService.ResetSubmissionAsync(
                invoiceId, request.Mode, request.Irn, request.Reason, actor);

            return result.Success ? Ok(result) : BadRequest(result);
        }

        // ── Reference Data v1 ───────────────────────────────────

        [HttpGet("provinces/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetProvinces(int companyId)
            => Ok(await _fbrService.GetProvincesAsync(companyId));

        [HttpGet("doctypes/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetDocTypes(int companyId)
            => Ok(await _fbrService.GetDocTypesAsync(companyId));

        [HttpGet("hscodes/{companyId}")]
        [AuthorizeCompany]
        [HasAnyPermission("fbr.reference.read", "itemtypes.manage.view", "itemtypes.manage.create",
            "itemtypes.manage.update", "invoices.manage.update.itemtype", "invoices.manage.update.itemtype.qty")]
        public async Task<IActionResult> GetHSCodes(int companyId, [FromQuery] string? search, [FromQuery] string? saleType,
            [FromQuery] bool excludeSaved = false, [FromQuery] string? includeHsCode = null)
            => Ok(await _fbrService.GetHSCodesAsync(companyId, search, saleType, excludeSaved, includeHsCode));

        /// <summary>
        /// Refreshes the offline HS code list from FBR, using this company's
        /// token. Seed admin only: the stored list is shared by every company.
        /// </summary>
        [HttpPost("hscodes/sync/{companyId}")]
        [HasPermission("fbr.config.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> SyncHSCodes(int companyId)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            var stored = await _fbrService.SyncHsCodeCatalogAsync(companyId);
            if (stored == 0)
                return BadRequest(new { message = "FBR returned no HS codes. Check this company's FBR token." });
            return Ok(new { stored });
        }

        /// <summary>
        /// One-off fill of the stored FBR unit list (FbrLookups "HsUom") from every HS
        /// code already in use anywhere: item types, invoice lines and consultant
        /// adjustments. Each code is stored once for the whole installation. Each lookup
        /// uses the token of a company that actually uses the code. Works in batches so
        /// the request stays short; call again with the returned nextOffset until done.
        /// Seed admin only, like the HS list sync.
        /// </summary>
        [HttpPost("hscodes/uom/seed")]
        [HasPermission("fbr.config.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> SeedHsUnits([FromQuery] int offset = 0, [FromQuery] int batch = 100)
        {
            batch = Math.Clamp(batch, 1, 300);
            offset = Math.Max(0, offset);

            var pairs = new List<(string Hs, int CompanyId)>();
            pairs.AddRange((await _db.ItemTypes.AsNoTracking()
                .Where(i => !i.IsDeleted && i.HSCode != null && i.HSCode != "")
                .Select(i => new { i.HSCode, i.CompanyId }).Distinct().ToListAsync())
                .Where(x => x.CompanyId != null).Select(x => (x.HSCode!.Trim(), x.CompanyId!.Value)));
            pairs.AddRange((await _db.InvoiceItems.AsNoTracking()
                .Where(i => i.HSCode != null && i.HSCode != "")
                .Select(i => new { i.HSCode, CompanyId = (int?)i.Invoice.CompanyId }).Distinct().ToListAsync())
                .Where(x => x.CompanyId != null).Select(x => (x.HSCode!.Trim(), x.CompanyId!.Value)));
            pairs.AddRange((await _db.InvoiceItemAdjustments.AsNoTracking()
                .Where(a => a.AdjustedHSCode != null && a.AdjustedHSCode != "")
                .Select(a => new { a.AdjustedHSCode, CompanyId = (int?)a.InvoiceItem.Invoice.CompanyId }).Distinct().ToListAsync())
                .Where(x => x.CompanyId != null).Select(x => (x.AdjustedHSCode!.Trim(), x.CompanyId!.Value)));

            var withToken = (await _db.Companies.AsNoTracking()
                .Where(c => c.FbrToken != null && c.FbrToken != "").Select(c => c.Id).ToListAsync()).ToHashSet();
            var stored = (await _db.FbrLookups.AsNoTracking()
                .Where(l => l.Category == TaxMappingEngine.HsUomCategory).Select(l => l.Code).ToListAsync())
                .Select(c => c[..c.IndexOf('|')]).ToHashSet(StringComparer.OrdinalIgnoreCase);

            // One row per HS code, whichever token-holding company uses it first.
            var todo = pairs.Where(p => withToken.Contains(p.CompanyId))
                .GroupBy(p => p.Hs, StringComparer.OrdinalIgnoreCase)
                .Where(g => !stored.Contains(g.Key))
                .OrderBy(g => g.Key, StringComparer.Ordinal)
                .Select(g => (Hs: g.Key, CompanyId: g.Min(x => x.CompanyId))).ToList();
            var noToken = pairs.Select(p => p.Hs).Distinct(StringComparer.OrdinalIgnoreCase)
                .Count(h => !stored.Contains(h) && !todo.Any(t => string.Equals(t.Hs, h, StringComparison.OrdinalIgnoreCase)));

            var done = 0; var empty = new List<string>();
            foreach (var (hs, companyId) in todo.Skip(offset).Take(batch))
            {
                var units = await _taxEngine.GetValidUomsForHsCodeAsync(companyId, hs);
                if (units.Count > 0) done++; else empty.Add(hs);
                await Task.Delay(100); // be gentle with PRAL
            }
            var next = offset + batch;
            return Ok(new
            {
                storedNow = done,
                noUnitsFromFbr = empty,
                codesWithoutAnyToken = noToken,
                stillToDo = Math.Max(0, todo.Count - next),
                nextOffset = next < todo.Count ? next : (int?)null,
            });
        }

        [HttpGet("uom/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetUOMs(int companyId)
            => Ok(await _fbrService.GetUOMsAsync(companyId));

        [HttpGet("transactiontypes/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetTransactionTypes(int companyId)
            => Ok(await _fbrService.GetTransactionTypesAsync(companyId));

        [HttpGet("sroitemcodes/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetSROItemCodes(int companyId)
            => Ok(await _fbrService.GetSROItemCodesAsync(companyId));

        // ── Reference Data v2 ───────────────────────────────────

        [HttpGet("saletyperates/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetSaleTypeRates(
            int companyId,
            [FromQuery] string date,
            [FromQuery] int transTypeId,
            [FromQuery] int provinceId)
            => Ok(await _fbrService.GetSaleTypeRatesAsync(companyId, date, transTypeId, provinceId));

        [HttpGet("sroschedule/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetSROSchedule(
            int companyId,
            [FromQuery] int rateId,
            [FromQuery] string date,
            [FromQuery] int provinceId)
            => Ok(await _fbrService.GetSROScheduleAsync(companyId, rateId, date, provinceId));

        [HttpGet("sroitems/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetSROItems(
            int companyId,
            [FromQuery] string date,
            [FromQuery] int sroId)
            => Ok(await _fbrService.GetSROItemsAsync(companyId, date, sroId));

        [HttpGet("hsuom/{companyId}")]
        [AuthorizeCompany]
        [HasPermission("fbr.reference.read")]
        public async Task<IActionResult> GetHSCodeUOM(
            int companyId,
            [FromQuery] string hsCode,
            [FromQuery] int annexureId)
            => Ok(await _fbrService.GetHSCodeUOMAsync(companyId, hsCode, annexureId));

        // ── STATL / Registration ────────────────────────────────

        [HttpPost("regstatus/{companyId}")]
        [HasPermission("fbr.config.view")]
        [AuthorizeCompany]
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
        [AuthorizeCompany]
        public async Task<IActionResult> GetRegistrationType(
            int companyId,
            [FromQuery] string regNo)
        {
            var result = await _fbrService.GetRegistrationTypeAsync(companyId, regNo);
            return result != null ? Ok(result) : BadRequest(new { message = "Could not determine registration type." });
        }
    }
}
