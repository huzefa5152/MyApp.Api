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

        public DashboardController(IDashboardService dashboard)
        {
            _dashboard = dashboard;
        }

        /// <summary>
        /// GET /api/dashboard/kpis?companyId=X&period=this-month
        ///
        /// Period accepts: this-week, last-week, this-month (default),
        /// last-month, this-year, last-year, all-time. Anything else
        /// falls back to all-time.
        ///
        /// TENANT SCOPE IS ENFORCED HERE. It used to say "the caller must
        /// already be authorised against the company; we trust the upstream
        /// guard" -- and there is no upstream guard. Anyone who could sign in
        /// and held dashboard.view could read any company's headline sales,
        /// its top clients BY NAME, its recent invoices and its stock, just by
        /// changing companyId in the query string. Found 2026-09-14 by asking
        /// for another tenant's dashboard as a freshly-created user.
        /// </summary>
        [HttpGet("kpis")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetKpis(
            [FromQuery] int companyId,
            [FromQuery] string period = "this-month")
        {
            if (companyId <= 0)
                return BadRequest(new { error = "companyId is required." });

            var response = await _dashboard.GetKpisAsync(companyId, period, User);
            return Ok(response);
        }

        /// <summary>
        /// GET /api/dashboard/breakdown?companyId=X&amp;kind=dead-stock&amp;period=all-time
        ///
        /// The rows behind one KPI. The rows sum to exactly what the card
        /// shows, because both come out of the same computation — see
        /// <c>DashboardService.GetBreakdownAsync</c>.
        ///
        /// Same tenant guard as the KPI endpoint, for the same reason: these
        /// rows name clients, item types and GD numbers, so an unguarded
        /// companyId would hand another tenant's book to anyone who could sign
        /// in (the defect found on the KPI endpoint on 2026-09-14).
        ///
        /// Kinds: sales, cogs, cogs-landed, real-margin, stock-on-hand,
        /// dead-stock, stock-converted, stock-ageing, unrealised-margin,
        /// inventory-adjustments, receivables, payables, recoverable-tax,
        /// import-book, duty-burden.
        /// </summary>
        [HttpGet("breakdown")]
        [AuthorizeCompany]
        public async Task<IActionResult> GetBreakdown(
            [FromQuery] int companyId,
            [FromQuery] string kind,
            [FromQuery] string period = "this-month")
        {
            if (companyId <= 0)
                return BadRequest(new { error = "companyId is required." });
            if (string.IsNullOrWhiteSpace(kind))
                return BadRequest(new { error = "kind is required." });

            var response = await _dashboard.GetBreakdownAsync(companyId, kind, period, User);
            return Ok(response);
        }
    }
}
