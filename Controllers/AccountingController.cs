using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The general ledger itself: its status, the period close, and the trial
    /// balance.
    ///
    /// There is no endpoint that turns GL posting OFF, and that is deliberate —
    /// see <c>Company.GlPostingEnabled</c>. A company whose documents have been
    /// posted cannot stop posting without its ledger drifting away from its
    /// documents, so the capability does not exist to be granted.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/accounting")]
    public class AccountingController : ControllerBase
    {
        private readonly IGeneralLedgerService _gl;
        private readonly IPostingService _posting;
        private readonly ILogger<AccountingController> _logger;

        public AccountingController(IGeneralLedgerService gl, IPostingService posting,
            ILogger<AccountingController> logger)
        {
            _gl = gl;
            _posting = posting;
            _logger = logger;
        }

        [HttpGet("gl/company/{companyId}/status")]
        [HasAnyPermission("accounting.gl.view", "accounting.coa.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<GlStatusDto>> GetStatus(int companyId)
        {
            try { return Ok(await _gl.GetStatusAsync(companyId)); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Close the books up to a date, or reopen them by clearing it.
        /// Nothing dated on or before the lock date can then be added, changed
        /// or removed — including a delete, which changes a filed figure exactly
        /// as much as an insert does.</summary>
        [HttpPut("gl/company/{companyId}/lock-date")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetLockDate(int companyId, [FromBody] SetLockDateDto dto)
        {
            try
            {
                await _gl.SetLockDateAsync(companyId, dto?.LockDate);
                return Ok(await _gl.GetStatusAsync(companyId));
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Re-post every document of a company from scratch. The repair
        /// hatch: it removes the system-posted entries, leaves manual journals
        /// alone, and posts each document again from its current state.
        ///
        /// Safe to run at any time — posting is replace-on-edit, so a rebuild
        /// lands on the same ledger a document-by-document history would have.
        /// Gated on gl.manage because it rewrites everybody's figures.</summary>
        [HttpPost("gl/company/{companyId}/rebuild")]
        [HasPermission("accounting.gl.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Rebuild(int companyId)
        {
            try
            {
                var result = await _posting.RebuildAsync(companyId);
                var status = await _gl.GetStatusAsync(companyId);
                return Ok(new { result, status });
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Ledger rebuild failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not rebuild the ledger." });
            }
        }

        [HttpGet("reports/company/{companyId}/trial-balance")]
        [HasPermission("accounting.gl.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<TrialBalanceDto>> GetTrialBalance(
            int companyId, [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            try { return Ok(await _gl.GetTrialBalanceAsync(companyId, from, to)); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Trial balance failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not build the trial balance." });
            }
        }
    }
}
