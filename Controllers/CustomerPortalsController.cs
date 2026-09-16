using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Management of Customer Portals — issuing, disabling and revoking the
    /// public links. Authenticated and RBAC-gated; the public half lives in
    /// <see cref="PublicCustomerPortalController"/>.
    ///
    /// Every response here carries a LIVE BEARER TOKEN in its PublicUrl, so the
    /// listing is scoped to the caller's accessible companies inside the query
    /// rather than filtered afterwards, and each by-id action asserts access
    /// against the portal's own stored CompanyId before it answers.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/customer-portals")]
    public class CustomerPortalsController : ControllerBase
    {
        private readonly ICustomerPortalService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<CustomerPortalsController> _logger;

        public CustomerPortalsController(
            ICustomerPortalService service, ICompanyAccessGuard access,
            ILogger<CustomerPortalsController> logger)
        {
            _service = service;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Builds the customer-facing link. The host comes from the REQUEST, not
        /// from configuration: this line is deployed behind more than one
        /// hostname, and a link built from a hard-coded host would be dead for
        /// whoever opened the screen on the other one.
        /// </summary>
        private Func<string, string> UrlBuilder()
        {
            var origin = $"{Request.Scheme}://{Request.Host}";
            return token => $"{origin}/portal/{token}";
        }

        [HttpGet]
        [HasPermission("customerportals.manage.view")]
        public async Task<ActionResult<List<CustomerPortalDto>>> GetAll()
        {
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(await _service.GetAllAsync(allowed.ToList(), UrlBuilder()));
        }

        [HttpGet("{id}")]
        [HasPermission("customerportals.manage.view")]
        public async Task<ActionResult<CustomerPortalDto>> GetById(int id)
        {
            var dto = await _service.GetByIdAsync(id, UrlBuilder());
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        /// <summary>Which documents a company can serve, so the create form does
        /// not offer a type the company has no template for.</summary>
        [HttpGet("company/{companyId}/document-options")]
        [HasPermission("customerportals.manage.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<PortalDocumentOptionDto>>> DocumentOptions(int companyId)
            => Ok(await _service.GetDocumentOptionsAsync(companyId));

        [HttpPost]
        [HasPermission("customerportals.manage.create")]
        public async Task<ActionResult<CustomerPortalDto>> Create([FromBody] CreateCustomerPortalDto dto)
        {
            // CompanyId arrives in the BODY, so the declarative guard can't see
            // it — asserted here before anything is created.
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                return Ok(await _service.CreateAsync(
                    dto.CompanyId, dto.ClientId, dto.DocumentType, CurrentUserId, UrlBuilder()));
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Creating a customer portal failed for company {CompanyId}", dto.CompanyId);
                return StatusCode(500, new { error = "Could not create the portal." });
            }
        }

        [HttpPut("{id}/document-type")]
        [HasPermission("customerportals.manage.update")]
        public async Task<ActionResult<CustomerPortalDto>> SetDocumentType(
            int id, [FromBody] SetPortalDocumentTypeDto dto)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var updated = await _service.SetDocumentTypeAsync(id, dto?.DocumentType, CurrentUserId, UrlBuilder());
            return updated == null ? NotFound() : Ok(updated);
        }

        /// <summary>Enable or disable the link. Disabling stops access at once;
        /// re-enabling restores the SAME token, so a customer who already has
        /// the link does not need a new one.</summary>
        [HttpPut("{id}/active")]
        [HasPermission("customerportals.manage.update")]
        public async Task<ActionResult<CustomerPortalDto>> SetActive(
            int id, [FromBody] SetCustomerPortalActiveDto dto)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.SetActiveAsync(id, dto?.IsActive ?? false, CurrentUserId, UrlBuilder());
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>Revoke for good. The row goes and the token can never
        /// resolve again — unlike disabling, this cannot be undone.</summary>
        [HttpDelete("{id}")]
        [HasPermission("customerportals.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var ok = await _service.DeleteAsync(id);
            return ok ? NoContent() : NotFound();
        }
    }
}
