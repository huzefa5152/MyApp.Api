using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Home-page KPI aggregator. One endpoint, permission-shaped — the
    /// service populates only the sections the caller has perm for and
    /// the page renders accordingly. dashboard.view is the gate; the
    /// fine-grained .kpi.* perms live inside the service so a single
    /// 403 can't accidentally hide the page from someone who has at
    /// least one KPI perm.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    [HasPermission("dashboard.view")]
    public class DashboardController : ControllerBase
    {
        private readonly IDashboardService _dashboard;
        private readonly ICompanyAccessGuard _access;

        public DashboardController(IDashboardService dashboard, ICompanyAccessGuard access)
        {
            _dashboard = dashboard;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// GET /api/dashboard/kpis?companyId=X&period=this-month
        ///
        /// Period accepts: this-week, last-week, this-month (default),
        /// last-month, this-year, last-year, all-time. Anything else
        /// falls back to all-time. Tenant scope: caller must already be
        /// authorised against the company; we trust the upstream guard.
        /// </summary>
        [HttpGet("kpis")]
        public async Task<IActionResult> GetKpis(
            [FromQuery] int companyId,
            [FromQuery] string period = "this-month")
        {
            if (companyId <= 0)
                return BadRequest(new { error = "companyId is required." });

            // Tenant scope (audit C1, 2026-07-27): the KPI service does NOT check
            // access, so without this any dashboard.view holder could read another
            // tenant's financials via ?companyId=<other>. Assert access up front.
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var response = await _dashboard.GetKpisAsync(companyId, period, User);
            return Ok(response);
        }
    }
}
