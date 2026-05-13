using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Backs the FBR communication monitor page. Audit H-3 (2026-05-08):
    /// pre-fix, FBR traffic was buried in AuditLogs alongside everything
    /// else; admins couldn't isolate FBR health. Each row here is one
    /// FBR / PRAL HTTP call with masked request/response bodies, FBR
    /// error codes, retry attempt, and duration.
    /// </summary>
    [ApiController]
    [Route("api/fbr-monitor")]
    [Authorize]
    [HasPermission("fbrmonitor.view")]
    public class FbrMonitorController : ControllerBase
    {
        private readonly IFbrCommunicationLogService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly int _defaultPageSize;

        public FbrMonitorController(
            IFbrCommunicationLogService service,
            ICompanyAccessGuard access,
            IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 25);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Paged list. Filters compose: companyId narrows to one tenant,
        /// status narrows to one bucket (failed / submitted / etc.),
        /// since/until bound the time window, invoiceId pins to a single bill.
        /// Audit C-2 (2026-05-13): every call is now tenant-scoped — passing
        /// companyId requires explicit access; omitting it falls back to
        /// the caller's accessible-company set.
        /// </summary>
        [HttpGet]
        public async Task<ActionResult<PagedResult<FbrCommunicationLogDto>>> GetLogs(
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] int? companyId = null,
            [FromQuery] string? action = null,
            [FromQuery] string? status = null,
            [FromQuery] int? invoiceId = null,
            [FromQuery] DateTime? since = null,
            [FromQuery] DateTime? until = null)
        {
            var clampedPage = PaginationHelper.ClampPage(page);
            var clampedSize = PaginationHelper.Clamp(pageSize, _defaultPageSize, PaginationHelper.AuditMax);

            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetPagedAsync(
                    clampedPage, clampedSize, companyId, action, status, invoiceId, since, until));
            }

            // No companyId filter — scope to the caller's accessible set so
            // a non-admin user with fbrmonitor.view cannot read another
            // tenant's FBR submission bodies by omitting the filter.
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(await _service.GetPagedAsync(
                clampedPage, clampedSize, null, action, status, invoiceId, since, until, allowed));
        }

        [HttpGet("{id:long}")]
        public async Task<ActionResult<FbrCommunicationLogDto>> GetLog(long id)
        {
            var log = await _service.GetByIdAsync(id);
            if (log == null) return NotFound();
            // Tenant scope — only allow read if the row belongs to a
            // company the caller can reach.
            await _access.AssertAccessAsync(CurrentUserId, log.CompanyId);
            return Ok(log);
        }

        /// <summary>
        /// Aggregate metrics for the dashboard top strip. Pass `hours` to
        /// pick the lookback window — defaults to 24.
        /// </summary>
        [HttpGet("summary")]
        public async Task<ActionResult<FbrCommunicationSummaryDto>> GetSummary(
            [FromQuery] int? companyId = null,
            [FromQuery] int hours = 24)
        {
            var since = DateTime.UtcNow.AddHours(-Math.Clamp(hours, 1, 24 * 30));

            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetSummaryAsync(companyId, since));
            }

            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(await _service.GetSummaryAsync(null, since, allowed));
        }
    }
}
