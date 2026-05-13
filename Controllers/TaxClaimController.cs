using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Per-HS-Code tax-claim helper. Read-only — feeds the in-form
    /// "input tax bank" panel on the Invoices-tab edit screen so the
    /// operator sees how much input tax is still claimable against
    /// historical purchases for each HS Code on the bill.
    ///
    /// Gated by invoices.list.update because the only callers are
    /// users who can edit invoices — same gate the page itself uses.
    /// No new permission added; keeps role admin simple.
    /// </summary>
    [Authorize]
    [ApiController]
    // Literal kebab-case route — `[controller]` would resolve to
    // `api/TaxClaim` and case-insensitive matching does NOT bridge the
    // hyphen, so a frontend call to `/api/tax-claim/...` would 405.
    // Same pattern other kebab-named controllers use (FbrPurchaseImport,
    // FbrPurchaseImportController).
    [Route("api/tax-claim")]
    public class TaxClaimController : ControllerBase
    {
        private readonly ITaxClaimService _taxClaim;

        public TaxClaimController(ITaxClaimService taxClaim)
        {
            _taxClaim = taxClaim;
        }

        /// <summary>
        /// POST /api/tax-claim/claim-summary
        /// Body: full TaxClaimSummaryRequest — companyId, billDate,
        /// billGstRate, billRows[{hsCode, itemTypeName, qty, value}],
        /// optional periodCode.
        ///
        /// Returns Phase-B claim summary with per-sale match, §8A
        /// aging, §8B 90% cap, IRIS reconciliation filter, and
        /// carry-forward proxy. Informational — never blocks a save.
        /// </summary>
        [HttpPost("claim-summary")]
        // Audit M-1 (2026-05-13): the old key 'invoices.list.update' was
        // never in PermissionCatalog so PermissionService treated it as
        // deny — only seed admin could ever reach this endpoint. Use
        // 'invoices.list.view' to match the rest of the Invoices tab.
        [HasPermission("invoices.list.view")]
        public async Task<IActionResult> ClaimSummary([FromBody] TaxClaimSummaryRequest request)
        {
            if (request == null || request.CompanyId <= 0)
                return BadRequest(new { error = "companyId is required." });
            var summary = await _taxClaim.GetClaimSummaryAsync(request);
            return Ok(summary);
        }
    }
}
