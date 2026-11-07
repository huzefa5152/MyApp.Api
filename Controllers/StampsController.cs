using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    // Company-level stamp / signature images. Each stamp is usable in any print
    // template as the merge field {{stamps.<slug>}} (resolves to the image URL),
    // so operators build multiple templates with different stamps and never paste
    // base64. The /data file guard checks the company; the image-session
    // cookie preserves ordinary <img src> rendering in print popups.
    [ApiController]
    [Route("api/companies/{companyId:int}/stamps")]
    [Authorize]
    public class StampsController : ControllerBase
    {
        private readonly ICompanyStampRepository _repo;
        private readonly ICompanyStampService _stamps;
        private readonly ICompanyAccessGuard _access;
        private readonly IAuditLogService _audit;

        public StampsController(ICompanyStampRepository repo, ICompanyStampService stamps, ICompanyAccessGuard access, IAuditLogService audit)
        {
            _repo = repo;
            _stamps = stamps;
            _access = access;
            _audit = audit;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        private async Task AuditAsync(string eventType, string message, int companyId)
        {
            try
            {
                await _audit.LogAsync(new AuditLog
                {
                    Timestamp = DateTime.UtcNow,
                    Level = "Information",
                    UserName = User.Identity?.Name,
                    HttpMethod = Request.Method,
                    RequestPath = Request.Path,
                    StatusCode = 200,
                    ExceptionType = eventType,
                    Message = message,
                    CompanyId = companyId,
                });
            }
            catch { /* audit must never break the operation */ }
        }

        private static CompanyStampDto ToDto(CompanyStamp s) => new()
        {
            Id = s.Id,
            CompanyId = s.CompanyId,
            Name = s.Name,
            Slug = s.Slug,
            Url = s.FilePath,
            IsDefault = s.IsDefault,
            SortOrder = s.SortOrder,
            UpdatedAt = s.UpdatedAt,
        };

        [HttpGet]
        [HasPermission("printtemplates.stamps.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> List(int companyId)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            var stamps = await _repo.GetByCompanyAsync(companyId);
            var usage = await _repo.TemplateUsageCountsAsync(companyId);
            var dtos = new List<CompanyStampDto>();
            foreach (var s in stamps)
            {
                var dto = ToDto(s);
                dto.UsedByTemplates = usage.GetValueOrDefault(s.Id);
                dtos.Add(dto);
            }
            return Ok(dtos);
        }

        // Mark this stamp as the company default. Pre-selected in the pickers,
        // and the stamp the built-in fallback templates render — those have no
        // PrintTemplate row, so there is no StampId for them to carry.
        [HttpPut("{id:int}/default")]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> SetDefault(int companyId, int id)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var stamp = await _stamps.SetDefaultAsync(companyId, id);
            if (stamp == null) return NotFound();

            await AuditAsync("COMPANYSTAMP_DEFAULT",
                $"Set stamp \"{stamp.Name}\" (id {id}) as default for company {companyId}", companyId);
            return Ok(ToDto(stamp));
        }

        [HttpPost]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Upload(int companyId, IFormFile file, [FromForm] string? name = null)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            CompanyStamp stamp;
            try { stamp = await _stamps.AddAsync(companyId, file, name); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }

            await AuditAsync("COMPANYSTAMP_CREATE",
                $"Uploaded stamp \"{stamp.Name}\" (slug {stamp.Slug}, id {stamp.Id}) in company {companyId}", companyId);
            return Ok(ToDto(stamp));
        }

        // New image, same stamp: the merge field and every template's assignment stay as they are.
        [HttpPut("{id:int}/image")]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> ReplaceImage(int companyId, int id, IFormFile file)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            CompanyStamp? stamp;
            try { stamp = await _stamps.ReplaceImageAsync(companyId, id, file); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            if (stamp == null) return NotFound();

            await AuditAsync("COMPANYSTAMP_REPLACE",
                $"Replaced the image of stamp \"{stamp.Name}\" (slug {stamp.Slug}, id {id}) in company {companyId}", companyId);
            return Ok(ToDto(stamp));
        }

        [HttpPut("{id:int}")]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Update(int companyId, int id, [FromBody] UpdateCompanyStampDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var stamp = await _stamps.UpdateAsync(companyId, id, dto.Name, dto.SortOrder);
            if (stamp == null) return NotFound();

            await AuditAsync("COMPANYSTAMP_UPDATE",
                $"Updated stamp \"{stamp.Name}\" (id {id}) in company {companyId}", companyId);
            return Ok(ToDto(stamp));
        }

        [HttpDelete("{id:int}")]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Delete(int companyId, int id)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var stamp = await _stamps.DeleteAsync(companyId, id);
            if (stamp == null) return NotFound();

            await AuditAsync("COMPANYSTAMP_DELETE",
                $"Deleted stamp \"{stamp.Name}\" (id {id}) from company {companyId}", companyId);
            return NoContent();
        }
    }
}
