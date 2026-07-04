using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class DivisionsController : ControllerBase
    {
        private readonly IDivisionService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly IWebHostEnvironment _env;

        public DivisionsController(IDivisionService service, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IWebHostEnvironment env)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
            _env = env;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // Divisions have their own RBAC namespace (divisions.manage.*) so a role
        // can manage them independently of full company-edit rights.
        [HttpGet("company/{companyId}")]
        [HasPermission("divisions.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<DivisionDto>>> GetByCompany(int companyId)
        {
            // This endpoint feeds every DivisionSelect dropdown — filter it
            // server-side so a division-restricted user never learns the
            // names of divisions they can't reach (dropdown filtering in the
            // frontend alone would be cosmetic, not security).
            var rows = await _service.GetByCompanyAsync(companyId);
            var allowed = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(allowed == null ? rows : rows.Where(d => allowed.Contains(d.Id)).ToList());
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("divisions.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<DivisionDto>> Create(int companyId, [FromBody] DivisionDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetByCompany), new { companyId }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}")]
        [HasPermission("divisions.manage.update")]
        public async Task<ActionResult<DivisionDto>> Update(int id, [FromBody] DivisionDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id}")]
        [HasPermission("divisions.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var ok = await _service.DeleteAsync(id);
            return ok ? NoContent() : NotFound();
        }

        // POST: api/divisions/{id}/logo — mirrors the company logo upload
        // (tenant guard + ImageUploadValidator + magic-bytes sniff). Saved as
        // division_{id}{ext} under data/uploads/logos so it never collides with
        // a company logo (company_{id}{ext}).
        [HttpPost("{id}/logo")]
        [HasPermission("divisions.manage.update")]
        public async Task<ActionResult<DivisionDto>> UploadLogo(int id, IFormFile file)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);

            var validation = ImageUploadValidator.Validate(file, ImageUploadValidator.LogoMaxBytes);
            if (validation != null)
                return BadRequest(new { message = validation });

            var uploadsDir = Path.Combine(_env.ContentRootPath, "data", "uploads", "logos");
            Directory.CreateDirectory(uploadsDir);

            // Path.GetFileName defends against path-traversal in FileName; the
            // extension was already validated by ImageUploadValidator.
            var ext = Path.GetExtension(Path.GetFileName(file.FileName ?? "")).ToLowerInvariant();
            var fileName = $"division_{id}{ext}";
            var filePath = Path.Combine(uploadsDir, fileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var logoPath = $"/data/uploads/logos/{fileName}";
            var updated = await _service.SetLogoAsync(id, logoPath);
            return updated == null ? NotFound() : Ok(updated);
        }
    }
}
