using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    [HasPermission("auditlogs.view")]
    public class AuditLogsController : ControllerBase
    {
        private readonly IAuditLogService _service;
        private readonly int _defaultPageSize;
        public AuditLogsController(IAuditLogService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        [HttpGet]
        public async Task<ActionResult<PagedResult<AuditLogDto>>> GetLogs(
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? level = null,
            [FromQuery] string? search = null)
            => Ok(await _service.GetPagedAsync(page, pageSize ?? _defaultPageSize, level, search));

        [HttpGet("{id}")]
        public async Task<ActionResult<AuditLogDto>> GetLog(int id)
        {
            var log = await _service.GetByIdAsync(id);
            if (log == null) return NotFound();
            return Ok(log);
        }

        [HttpGet("summary")]
        public async Task<ActionResult<AuditSummaryDto>> GetSummary()
            => Ok(await _service.GetSummaryAsync());
    }
}
