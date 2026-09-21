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
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    [HasPermission("auditlogs.view")]
    public class AuditLogsController : ControllerBase
    {
        private readonly IAuditLogService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;
        private readonly int _defaultPageSize;

        public AuditLogsController(
            IAuditLogService service,
            ICompanyAccessGuard access,
            IPermissionService permissions,
            IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _permissions = permissions;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// The companies whose audit rows this caller may read, or null for the
        /// seed admin, who reads everything including the CompanyId-less
        /// platform rows (login failures, startup, anything raised outside a
        /// company context).
        ///
        /// 2026-09-21: the log used to be unscoped entirely — one key,
        /// auditlogs.view, and you read every tenant's activity. It was
        /// contained only because no tenant role carries that key. Scoping it
        /// removes the trap rather than relying on nobody stepping in it.
        ///
        /// Note what a scoped caller does NOT get: the platform rows. Most rows
        /// carry no company, so a tenant sees a genuinely partial log — that is
        /// the honest shape, because those events are not theirs.
        /// </summary>
        private async Task<IReadOnlyCollection<int>?> ScopeAsync()
        {
            if (_permissions.IsSeedAdmin(CurrentUserId)) return null;
            return (await _access.GetAccessibleCompanyIdsAsync(CurrentUserId)).ToList();
        }

        [HttpGet]
        public async Task<ActionResult<PagedResult<AuditLogDto>>> GetLogs(
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? level = null,
            [FromQuery] string? search = null)
            => Ok(await _service.GetPagedAsync(
                PaginationHelper.ClampPage(page),
                PaginationHelper.Clamp(pageSize, _defaultPageSize, PaginationHelper.AuditMax),
                level, search, await ScopeAsync()));

        [HttpGet("{id}")]
        public async Task<ActionResult<AuditLogDto>> GetLog(int id)
        {
            var log = await _service.GetByIdAsync(id, await ScopeAsync());
            if (log == null) return NotFound();
            return Ok(log);
        }

        [HttpGet("summary")]
        public async Task<ActionResult<AuditSummaryDto>> GetSummary()
            => Ok(await _service.GetSummaryAsync(await ScopeAsync()));
    }
}
