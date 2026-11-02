using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Shared starter designs (2026-10-29): installation-wide, no company. Anyone who can open the
    /// template editor or the starter gallery may read them -- they hold no company data, and
    /// StarterTemplateRules keeps it that way. Writes are the seed admin's only ([SeedAdminOnly],
    /// and the service checks again): a tenant Administrator holding every key is still refused.
    /// MCP's prepare_starter_template goes through the same service.
    /// </summary>
    [ApiController]
    [Route("api/starter-templates")]
    [Authorize]
    public class StarterTemplatesController(IStarterTemplateService service) : ControllerBase
    {
        private int CurrentUserId =>
            int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

        public sealed class StarterDto
        {
            public int Id { get; set; }
            public string TemplateType { get; set; } = "";
            public string Name { get; set; } = "";
            public string? Description { get; set; }
            public string? HtmlContent { get; set; }
            public bool IsActive { get; set; }
            public int SortOrder { get; set; }
            public string Revision { get; set; } = "";
            public DateTime UpdatedAt { get; set; }
        }

        public sealed class StarterWriteDto
        {
            public string TemplateType { get; set; } = "";
            public string Name { get; set; } = "";
            public string? Description { get; set; }
            public string HtmlContent { get; set; } = "";
            public int SortOrder { get; set; }
            /// <summary>Required for an update, activate or delete: the revision that was read.</summary>
            public string? Revision { get; set; }
            /// <summary>Merge fields the type does not offer print blank; saving them needs this explicit yes.</summary>
            public bool AcceptUnknownFields { get; set; }
        }

        public sealed class StarterStateDto
        {
            public string Revision { get; set; } = "";
            public bool Active { get; set; }
        }

        internal static StarterDto ToDto(StarterTemplate s, bool withHtml) => new()
        {
            Id = s.Id, TemplateType = s.TemplateType, Name = s.Name, Description = s.Description,
            HtmlContent = withHtml ? s.HtmlContent : null, IsActive = s.IsActive, SortOrder = s.SortOrder,
            Revision = StarterTemplateService.Revision(s), UpdatedAt = s.UpdatedAt ?? s.CreatedAt,
        };

        private IActionResult Refused(StarterTemplateException ex) => StatusCode(ex.Status, new { message = ex.Message });

        /// <summary>Active starters (with their HTML, for the gallery). The seed admin may ask for hidden ones too.</summary>
        [HttpGet]
        [HasAnyPermission("printtemplates.manage.view", "printtemplates.starter.apply")]
        public async Task<IActionResult> List([FromQuery] string? type, [FromQuery] bool includeInactive = false)
        {
            var all = includeInactive && HttpContext.RequestServices.GetRequiredService<IPermissionService>().IsSeedAdmin(CurrentUserId);
            var rows = await service.ListAsync(type, all);
            return Ok(rows.Select(r => ToDto(r, withHtml: true)));
        }

        [HttpPost]
        [HasPermission("printtemplates.manage.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> Create([FromBody] StarterWriteDto dto)
        {
            try
            {
                var row = await service.CreateAsync(CurrentUserId, User.Identity?.Name, dto.TemplateType, dto.Name, dto.Description, dto.HtmlContent, dto.SortOrder, dto.AcceptUnknownFields);
                return Ok(ToDto(row, withHtml: true));
            }
            catch (StarterTemplateException ex) { return Refused(ex); }
        }

        [HttpPut("{id:int}")]
        [HasPermission("printtemplates.manage.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> Update(int id, [FromBody] StarterWriteDto dto)
        {
            try
            {
                var row = await service.UpdateAsync(CurrentUserId, User.Identity?.Name, id, dto.Revision ?? "", dto.Name, dto.Description, dto.HtmlContent, dto.SortOrder, dto.AcceptUnknownFields);
                return Ok(ToDto(row, withHtml: true));
            }
            catch (StarterTemplateException ex) { return Refused(ex); }
        }

        [HttpPut("{id:int}/active")]
        [HasPermission("printtemplates.manage.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> SetActive(int id, [FromBody] StarterStateDto dto)
        {
            try { return Ok(ToDto(await service.SetActiveAsync(CurrentUserId, User.Identity?.Name, id, dto.Revision, dto.Active), withHtml: false)); }
            catch (StarterTemplateException ex) { return Refused(ex); }
        }

        [HttpDelete("{id:int}")]
        [HasPermission("printtemplates.manage.update")]
        [SeedAdminOnly]
        public async Task<IActionResult> Delete(int id, [FromQuery] string revision)
        {
            try { await service.DeleteAsync(CurrentUserId, User.Identity?.Name, id, revision ?? ""); return NoContent(); }
            catch (StarterTemplateException ex) { return Refused(ex); }
        }
    }
}
