using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = "Admin")]
    public class AuditLogsController : ControllerBase
    {
        private readonly IAuditLogService _service;
        public AuditLogsController(IAuditLogService service) => _service = service;

        [HttpGet]
        public async Task<ActionResult<PagedResult<AuditLogDto>>> GetLogs(
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 20,
            [FromQuery] string? level = null,
            [FromQuery] string? search = null)
            => Ok(await _service.GetPagedAsync(page, pageSize, level, search));

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
