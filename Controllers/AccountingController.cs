using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// GL administration (enable/backfill/lock date), financial reports
    /// (trial balance, AR/AP aging) and the accounting summary. Every route is
    /// company-scoped and tenant-guarded via [AuthorizeCompany].
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/accounting")]
    public class AccountingController : ControllerBase
    {
        private readonly IGeneralLedgerService _gl;
        private readonly ILogger<AccountingController> _logger;

        public AccountingController(IGeneralLedgerService gl, ILogger<AccountingController> logger)
        {
            _gl = gl;
            _logger = logger;
        }

        // ── GL administration ─────────────────────────────────────────────────

        [HttpGet("gl/company/{companyId}/status")]
        [HasPermission("accounting.coa.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<GlStatusDto>> GetStatus(int companyId)
        {
            try { return Ok(await _gl.GetStatusAsync(companyId)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Seeds the CoA when empty, turns posting on and backfills
        /// journal entries for every existing document. Idempotent.</summary>
        [HttpPost("gl/company/{companyId}/enable")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<GlEnableResultDto>> Enable(int companyId)
        {
            try { return Ok(await _gl.EnableAsync(companyId)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Wipes system-posted entries and re-posts every document
        /// (manual journals survive). The repair hatch.</summary>
        [HttpPost("gl/company/{companyId}/rebuild")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<ActionResult<GlEnableResultDto>> Rebuild(int companyId)
        {
            try { return Ok(await _gl.RebuildAsync(companyId)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>
        /// Re-posts every New Arrivals GD of the company on the DECLARED basis
        /// (2026-10-05, maintainer's decision): Inventory at declared value,
        /// Import Clearing at landed cost + import taxes (unchanged -- the
        /// settlement cap stays what it was), the difference to the Inventory
        /// valuation reserve. Each entry is replaced in place, so running it
        /// twice changes nothing the second time. A GD in a locked period is
        /// reported and left alone, never forced. Audited.
        /// </summary>
        [HttpPost("gl/company/{companyId}/repost-arrivals")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> RepostArrivals(int companyId)
        {
            var db = HttpContext.RequestServices.GetRequiredService<MyApp.Api.Data.AppDbContext>();
            var posting = HttpContext.RequestServices.GetRequiredService<IPostingService>();
            var audit = HttpContext.RequestServices.GetRequiredService<IAuditLogService>();
            if (!await posting.IsEnabledAsync(companyId))
                return BadRequest(new { error = "The general ledger is off for this company: nothing is posted to re-post." });
            var gds = await db.ImportConsignments
                .Where(c => c.CompanyId == companyId && c.Mode == MyApp.Api.DTOs.GdCostingImportModeNames.NewArrivals)
                .OrderBy(c => c.GdDate).ThenBy(c => c.Id).ToListAsync();
            var results = new List<object>();
            foreach (var c in gds)
            {
                var before = c.ImportClearingCredited;
                try
                {
                    await posting.PostImportConsignmentAsync(c);
                    results.Add(new { c.Id, c.GdNumber, c.GdDate, reposted = true, clearingBefore = before, clearingAfter = c.ImportClearingCredited });
                }
                catch (InvalidOperationException ex)
                {
                    _logger.LogWarning(ex, "Arrival re-post skipped for consignment {Id}", c.Id);
                    results.Add(new { c.Id, c.GdNumber, c.GdDate, reposted = false, reason = ex.Message });
                }
            }
            await audit.LogAsync(new MyApp.Api.Models.AuditLog
            {
                Timestamp = DateTime.UtcNow, Level = "Information", UserName = User.Identity?.Name,
                HttpMethod = "POST", RequestPath = $"/api/accounting/gl/company/{companyId}/repost-arrivals",
                StatusCode = 200, ExceptionType = "ARRIVALS_DECLARED_BASIS_REPOST",
                Message = $"Re-posted {results.Count} New Arrivals GD(s) on the declared basis for company {companyId}",
                CompanyId = companyId,
            });
            return Ok(new { companyId, gds = results });
        }

        [HttpPut("gl/company/{companyId}/lock-date")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetLockDate(int companyId, [FromBody] SetLockDateDto dto)
        {
            try
            {
                await _gl.SetLockDateAsync(companyId, dto.LockDate);
                return NoContent();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        // ── Reports ───────────────────────────────────────────────────────────

        [HttpGet("reports/company/{companyId}/trial-balance")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<TrialBalanceDto>> TrialBalance(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
            => Ok(await _gl.GetTrialBalanceAsync(companyId, from, to));

        [HttpGet("reports/company/{companyId}/aged-receivables")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AgedReportDto>> AgedReceivables(int companyId)
            => Ok(await _gl.GetAgedReceivablesAsync(companyId));

        [HttpGet("reports/company/{companyId}/aged-payables")]
        [HasPermission("accounting.reports.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AgedReportDto>> AgedPayables(int companyId)
            => Ok(await _gl.GetAgedPayablesAsync(companyId));

        // ── Summary (accounting dashboard) ────────────────────────────────────

        [HttpGet("summary/company/{companyId}")]
        [HasPermission("accounting.dashboard.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<AccountingSummaryDto>> Summary(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
            => Ok(await _gl.GetSummaryAsync(companyId, from, to));
    }
}
