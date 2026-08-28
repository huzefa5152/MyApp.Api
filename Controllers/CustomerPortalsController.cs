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
    /// Internal management of Customer Portals — create, enable/disable, revoke.
    ///
    /// Note what <c>customerportal.list.view</c> really grants: the list response
    /// carries live public URLs, and a portal URL is a bearer capability over a
    /// client's invoices. It is gated as a read, but it should be assigned like a
    /// credential.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/customer-portals")]
    public class CustomerPortalsController : ControllerBase
    {
        private readonly ICustomerPortalService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IConfiguration _config;

        public CustomerPortalsController(
            ICustomerPortalService service, ICompanyAccessGuard access, IConfiguration config)
        {
            _service = service;
            _access = access;
            _config = config;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Builds the customer-facing link. Server-side so the secret URL's shape
        /// is decided in one place; <c>CustomerPortal:BaseUrl</c> overrides the
        /// request host for deployments behind a different public name.
        /// </summary>
        private Func<string, string> UrlBuilder()
        {
            var configured = _config["CustomerPortal:BaseUrl"];
            var origin = !string.IsNullOrWhiteSpace(configured)
                ? configured.TrimEnd('/')
                : $"{Request.Scheme}://{Request.Host}";
            return token => $"{origin}/portal/{token}";
        }

        [HttpGet]
        [HasPermission("customerportal.list.view")]
        public async Task<ActionResult<List<CustomerPortalDto>>> GetAll()
        {
            // Scoped to the caller's tenants, like every other cross-company list.
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            return Ok(await _service.GetAllAsync(allowed.ToList(), UrlBuilder()));
        }

        [HttpGet("{id:int}")]
        [HasPermission("customerportal.list.view")]
        public async Task<ActionResult<CustomerPortalDto>> GetById(int id)
        {
            var dto = await _service.GetByIdAsync(id, UrlBuilder());
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        [HttpPost]
        [HasPermission("customerportal.manage.create")]
        public async Task<ActionResult<CustomerPortalDto>> Create([FromBody] CreateCustomerPortalDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                var created = await _service.CreateAsync(
                    dto.CompanyId, dto.ClientId, dto.DocumentType, CurrentUserId, UrlBuilder());
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>
        /// Which invoice documents this company can produce, so the create dialog
        /// can offer only the ones that will actually work.
        /// </summary>
        [HttpGet("document-options")]
        [HasPermission("customerportal.manage.create")]
        public async Task<ActionResult<List<PortalDocumentOptionDto>>> GetDocumentOptions([FromQuery] int companyId)
        {
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _service.GetDocumentOptionsAsync(companyId));
        }

        /// <summary>Change the document an existing portal serves. The link is unchanged.</summary>
        [HttpPut("{id:int}/document-type")]
        [HasPermission("customerportal.manage.update")]
        public async Task<ActionResult<CustomerPortalDto>> SetDocumentType(
            int id, [FromBody] SetPortalDocumentTypeDto body)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.SetDocumentTypeAsync(id, body.DocumentType, CurrentUserId, UrlBuilder());
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id:int}/active")]
        [HasPermission("customerportal.manage.update")]
        public async Task<ActionResult<CustomerPortalDto>> SetActive(int id, [FromBody] SetCustomerPortalActiveDto body)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.SetActiveAsync(id, body.IsActive, CurrentUserId, UrlBuilder());
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id:int}")]
        [HasPermission("customerportal.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id, UrlBuilder());
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            return await _service.DeleteAsync(id) ? NoContent() : NotFound();
        }
    }
}
