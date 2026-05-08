using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
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
        private readonly int _defaultPageSize;

        public FbrMonitorController(IFbrCommunicationLogService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 25);
        }

        /// <summary>
        /// Paged list. Filters compose: companyId narrows to one tenant,
        /// status narrows to one bucket (failed / submitted / etc.),
        /// since/until bound the time window, invoiceId pins to a single bill.
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
            => Ok(await _service.GetPagedAsync(
                page, pageSize ?? _defaultPageSize, companyId, action, status, invoiceId, since, until));

        [HttpGet("{id:long}")]
        public async Task<ActionResult<FbrCommunicationLogDto>> GetLog(long id)
        {
            var log = await _service.GetByIdAsync(id);
            if (log == null) return NotFound();
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
            return Ok(await _service.GetSummaryAsync(companyId, since));
        }
    }
}
