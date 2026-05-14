using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.DTOs;
using MyApp.Api.Models;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class CompaniesController : ControllerBase
    {
        private readonly ICompanyService _companyService;
        private readonly ICompanyAccessGuard _access;
        private readonly IPermissionService _permissions;
        private readonly IWebHostEnvironment _env;
        private readonly AppDbContext _context;
        private readonly IConfiguration _configuration;

        public CompaniesController(
            ICompanyService companyService,
            ICompanyAccessGuard access,
            IPermissionService permissions,
            IWebHostEnvironment env,
            AppDbContext context,
            IConfiguration configuration)
        {
            _companyService = companyService;
            _access = access;
            _permissions = permissions;
            _env = env;
            _context = context;
            _configuration = configuration;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // GET: api/companies
        // Returns only the companies the caller has tenant access to. Today
        // most companies are IsTenantIsolated=false → CompanyAccessGuard
        // returns "everything", preserving legacy behaviour. Once a company
        // is flipped isolated, only users with a UserCompanies row see it
        // here — which means every company-picker dropdown in the SPA gets
        // filtered automatically without per-page changes.
        [HttpGet]
        public async Task<ActionResult<IEnumerable<CompanyDto>>> GetCompanies()
        {
            var companies = await _companyService.GetAllAsync();
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(companies.Where(c => allowed.Contains(c.Id)));
        }

        // GET: api/companies/{id}
        [HttpGet("{id}")]
        public async Task<ActionResult<CompanyDto>> GetCompany(int id)
        {
            // Audit M-5 (2026-05-13): check access BEFORE the 404 so
            // response timing / status doesn't distinguish "exists in
            // another tenant" from "doesn't exist at all". Both paths
            // now return 404 uniformly.
            if (!await _access.HasAccessAsync(CurrentUserId, id))
                return NotFound();
            var company = await _companyService.GetByIdAsync(id);
            if (company == null) return NotFound();
            return Ok(company);
        }

        // POST: api/companies
        [HttpPost]
        [HasPermission("companies.manage.create")]
        public async Task<ActionResult<CompanyDto>> CreateCompany([FromBody] CreateCompanyDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            try
            {
                var createdCompany = await _companyService.CreateAsync(dto);

                // Auto-grant the creator access to the company they just made.
                // Without this, a non-seed-admin user creates a company and is
                // immediately locked out by the fail-closed CompanyAccessGuard
                // (no UserCompanies row → every companyId-scoped endpoint 403s).
                // Seed admin gets implicit access via CompanyAccessGuard, so we
                // skip the row for them — keeps the table free of redundant rows.
                var seedAdminUserId = _configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
                if (CurrentUserId > 0 && CurrentUserId != seedAdminUserId)
                {
                    var already = await _context.UserCompanies
                        .AnyAsync(uc => uc.UserId == CurrentUserId && uc.CompanyId == createdCompany.Id);
                    if (!already)
                    {
                        _context.UserCompanies.Add(new UserCompany
                        {
                            UserId = CurrentUserId,
                            CompanyId = createdCompany.Id,
                            AssignedAt = DateTime.UtcNow,
                            AssignedByUserId = CurrentUserId,
                        });
                        await _context.SaveChangesAsync();
                        // Drop this user's cached accessible-set so the next
                        // request sees the new grant immediately instead of
                        // waiting out the 60s sliding TTL.
                        _access.InvalidateUser(CurrentUserId);
                    }
                }

                return CreatedAtAction(nameof(GetCompany), new { id = createdCompany.Id }, createdCompany);
            }
            catch (InvalidOperationException ex)
            {
                // Return 400 Bad Request with the duplicate name message
                return BadRequest(new { message = ex.Message });
            }
        }

        // PUT: api/companies/{id}
        [HttpPut("{id}")]
        [HasPermission("companies.manage.update")]
        public async Task<ActionResult<CompanyDto>> UpdateCompany(int id, [FromBody] UpdateCompanyDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            await _access.AssertAccessAsync(CurrentUserId, id);

            // Audit H-1 / H-16 (2026-05-13): privileged sub-fields on the
            // company DTO need their own permission gates. If the caller
            // doesn't hold the relevant permission, we silently strip the
            // sensitive field from the incoming DTO so the rest of the
            // edit still goes through. This matches the audit guidance to
            // keep edit-the-rest UX intact while denying the privileged
            // change.
            var existing = await _companyService.GetByIdAsync(id);
            if (existing == null) return NotFound();

            // Tenant-isolation flip — only the dedicated perm OR seed admin.
            if (dto.IsTenantIsolated != existing.IsTenantIsolated
                && !await _permissions.HasPermissionAsync(CurrentUserId, "tenantaccess.manage.update"))
            {
                dto.IsTenantIsolated = existing.IsTenantIsolated;
            }

            // FBR token — separate perm. dto.FbrToken == null means "no
            // change"; "" means "clear". Only enforce on a real value.
            // The view DTO exposes HasFbrToken, not the value, so we use
            // that signal to detect "rotating an existing token".
            if (!string.IsNullOrEmpty(dto.FbrToken)
                && !await _permissions.HasPermissionAsync(CurrentUserId, "companies.manage.fbrtoken"))
            {
                dto.FbrToken = null;
            }

            try
            {
                var updatedCompany = await _companyService.UpdateAsync(id, dto);

                if (updatedCompany == null)
                    return NotFound();

                // The IsTenantIsolated flag may have just changed, which
                // affects who passes the "open mode" branch in the access
                // guard. Bump the generation so cached accessible-company
                // sets re-evaluate on next request.
                _access.InvalidateAll();

                return Ok(updatedCompany);
            }
            catch (InvalidOperationException ex)
            {
                // Return 400 Bad Request with the duplicate name message
                return BadRequest(new { message = ex.Message });
            }
        }

        // DELETE: api/companies/{id}
        [HttpDelete("{id}")]
        [HasPermission("companies.manage.delete")]
        public async Task<IActionResult> DeleteCompany(int id)
        {
            // Tenant guard — audit C-4 (2026-05-13): the cascade in
            // CompanyService.DeleteAsync nukes invoices, challans, clients,
            // items, templates for that company. Without this guard, a
            // user with companies.manage.delete on tenant A could DELETE
            // tenant B's company.
            await _access.AssertAccessAsync(CurrentUserId, id);
            await _companyService.DeleteAsync(id);
            return NoContent();
        }

        // POST: api/companies/{id}/logo
        [HttpPost("{id}/logo")]
        [HasPermission("companies.manage.update")]
        public async Task<ActionResult<CompanyDto>> UploadLogo(int id, IFormFile file)
        {
            // Audit H-3 (2026-05-13): tenant guard + layered validation.
            // Pre-fix this endpoint had no tenant guard and no size /
            // extension / magic-bytes check at all.
            await _access.AssertAccessAsync(CurrentUserId, id);

            var validation = MyApp.Api.Helpers.ImageUploadValidator.Validate(
                file, MyApp.Api.Helpers.ImageUploadValidator.LogoMaxBytes);
            if (validation != null)
                return BadRequest(new { message = validation });

            var company = await _companyService.GetByIdAsync(id);
            if (company == null) return NotFound();

            var uploadsDir = Path.Combine(_env.ContentRootPath, "data", "uploads", "logos");
            Directory.CreateDirectory(uploadsDir);

            // Use Path.GetFileName to defend against path-traversal in
            // FileName (e.g. "../../wwwroot/x.html") — extension was
            // already validated above so the saved file is safe.
            var ext = Path.GetExtension(Path.GetFileName(file.FileName ?? "")).ToLowerInvariant();
            var fileName = $"company_{id}{ext}";
            var filePath = Path.Combine(uploadsDir, fileName);

            using (var stream = new FileStream(filePath, FileMode.Create))
            {
                await file.CopyToAsync(stream);
            }

            var logoPath = $"/data/uploads/logos/{fileName}";

            var updateDto = new UpdateCompanyDto
            {
                Name = company.Name,
                BrandName = company.BrandName,
                FullAddress = company.FullAddress,
                Phone = company.Phone,
                NTN = company.NTN,
                STRN = company.STRN,
                LogoPath = logoPath,
                StartingChallanNumber = company.StartingChallanNumber,
                StartingInvoiceNumber = company.StartingInvoiceNumber
            };
            var updated = await _companyService.UpdateAsync(id, updateDto);
            return Ok(updated);
        }
    }
}
