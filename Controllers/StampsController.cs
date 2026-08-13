using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
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
    // base64. Files are served publicly by the /data static provider — same class
    // as the company logo (required so <img src> works in the print popup).
    [ApiController]
    [Route("api/companies/{companyId:int}/stamps")]
    [Authorize]
    public class StampsController : ControllerBase
    {
        private readonly ICompanyStampRepository _repo;
        private readonly ICompanyAccessGuard _access;
        private readonly IAuditLogService _audit;

        public StampsController(ICompanyStampRepository repo, ICompanyAccessGuard access, IAuditLogService audit)
        {
            _repo = repo;
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
            var dtos = new List<CompanyStampDto>();
            foreach (var s in stamps)
            {
                var dto = ToDto(s);
                dto.UsedByTemplates = await _repo.TemplateUsageCountAsync(s.Id);
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

            var stamp = await _repo.GetByIdAsync(id);
            if (stamp == null || stamp.CompanyId != companyId) return NotFound();

            await _repo.SetDefaultAsync(companyId, id);
            await AuditAsync("COMPANYSTAMP_DEFAULT",
                $"Set stamp \"{stamp.Name}\" (id {id}) as default for company {companyId}", companyId);

            var refreshed = await _repo.GetByIdAsync(id);
            return Ok(ToDto(refreshed!));
        }

        [HttpPost]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Upload(int companyId, IFormFile file, [FromForm] string? name = null)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var err = ImageUploadValidator.Validate(file, ImageUploadValidator.LogoMaxBytes);
            if (err != null) return BadRequest(new { error = err });

            var displayName = string.IsNullOrWhiteSpace(name)
                ? Path.GetFileNameWithoutExtension(file.FileName) ?? "Stamp"
                : name.Trim();
            if (string.IsNullOrWhiteSpace(displayName)) displayName = "Stamp";
            if (displayName.Length > 100) displayName = displayName[..100];

            // Stable, unique-per-company slug. Never changes after creation.
            var slug = await UniqueSlugAsync(companyId, displayName);

            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (string.IsNullOrEmpty(ext)) ext = ".png";

            var relDir = $"data/uploads/stamps/company_{companyId}";
            var absDir = Path.Combine(Directory.GetCurrentDirectory(), relDir);
            Directory.CreateDirectory(absDir);

            var fileName = $"{slug}{ext}";
            var absPath = Path.Combine(absDir, fileName);
            using (var stream = new FileStream(absPath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var relativeUrl = $"/{relDir}/{fileName}";
            var stamp = await _repo.CreateAsync(new CompanyStamp
            {
                CompanyId = companyId,
                Name = displayName,
                Slug = slug,
                FilePath = relativeUrl,
                SortOrder = await _repo.NextSortOrderAsync(companyId),
                UpdatedAt = DateTime.UtcNow,
            });

            await AuditAsync("COMPANYSTAMP_CREATE",
                $"Uploaded stamp \"{displayName}\" (slug {slug}, id {stamp.Id}) in company {companyId}", companyId);
            return Ok(ToDto(stamp));
        }

        [HttpPut("{id:int}")]
        [HasPermission("printtemplates.stamps.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Update(int companyId, int id, [FromBody] UpdateCompanyStampDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var stamp = await _repo.GetByIdAsync(id);
            if (stamp == null || stamp.CompanyId != companyId) return NotFound();

            // Slug is intentionally NOT touched — templates reference it.
            if (!string.IsNullOrWhiteSpace(dto.Name))
            {
                var n = dto.Name.Trim();
                stamp.Name = n.Length > 100 ? n[..100] : n;
            }
            if (dto.SortOrder.HasValue) stamp.SortOrder = dto.SortOrder.Value;
            stamp.UpdatedAt = DateTime.UtcNow;
            await _repo.SaveAsync();

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

            var stamp = await _repo.GetByIdAsync(id);
            if (stamp == null || stamp.CompanyId != companyId) return NotFound();

            // Remove the file (best-effort — a missing file must not block the row delete).
            try
            {
                var abs = Path.Combine(Directory.GetCurrentDirectory(), stamp.FilePath.TrimStart('/'));
                if (System.IO.File.Exists(abs)) System.IO.File.Delete(abs);
            }
            catch { /* orphaned file is harmless; row delete is what matters */ }

            await _repo.DeleteAsync(stamp);
            await AuditAsync("COMPANYSTAMP_DELETE",
                $"Deleted stamp \"{stamp.Name}\" (id {id}) from company {companyId}", companyId);
            return NoContent();
        }

        // ── slug helpers ──

        private async Task<string> UniqueSlugAsync(int companyId, string name)
        {
            var baseSlug = Slugify(name);
            var slug = baseSlug;
            var n = 2;
            while (await _repo.SlugExistsAsync(companyId, slug))
                slug = $"{baseSlug}_{n++}";
            return slug;
        }

        // [a-z0-9_], collapse runs of non-alnum to a single underscore, never
        // starts with a digit (Handlebars path segment safety), capped length.
        private static string Slugify(string input)
        {
            var sb = new StringBuilder();
            bool lastUnderscore = false;
            foreach (var ch in input.Trim().ToLowerInvariant())
            {
                if (char.IsLetterOrDigit(ch) && ch < 128)
                {
                    sb.Append(ch);
                    lastUnderscore = false;
                }
                else if (!lastUnderscore)
                {
                    sb.Append('_');
                    lastUnderscore = true;
                }
            }
            var slug = sb.ToString().Trim('_');
            if (string.IsNullOrEmpty(slug)) slug = "stamp";
            if (char.IsDigit(slug[0])) slug = "s_" + slug;
            if (slug.Length > 50) slug = slug[..50].Trim('_');
            return slug;
        }
    }
}
