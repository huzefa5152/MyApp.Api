using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Backs the FBR Sandbox tab. Every endpoint is RBAC-gated — see
    /// <see cref="MyApp.Api.Helpers.PermissionCatalog"/> for the four
    /// `fbr.sandbox.*` keys that protect this controller. Default Administrator
    /// role gets all four; other roles need explicit grants on the Roles UI.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/fbr/sandbox")]
    public class FbrSandboxController : ControllerBase
    {
        private readonly IFbrSandboxService _service;

        public FbrSandboxController(IFbrSandboxService service)
        {
            _service = service;
        }

        /// <summary>List all demo bills for a company (FBR Sandbox tab table).</summary>
        [HttpGet("{companyId}")]
        [HasPermission("fbr.sandbox.view")]
        [AuthorizeCompany]
        public async Task<IActionResult> List(int companyId)
            => Ok(await _service.ListAsync(companyId));

        /// <summary>
        /// Auto-create demo scenario bills for a company. Picks scenarios
        /// from the company's BusinessActivity × Sector profile via the §10
        /// matrix. Idempotent — skips scenarios already seeded for this
        /// company. Demo bills use 900000+ numbering and never bump the
        /// company's main bill counter.
        /// </summary>
        [HttpPost("{companyId}/seed")]
        [HasPermission("fbr.sandbox.seed")]
        [AuthorizeCompany]
        public async Task<IActionResult> Seed(int companyId)
        {
            try
            {
                var result = await _service.SeedAsync(companyId);
                return Ok(result);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
        }

        /// <summary>Validate every demo bill against PRAL (no commitment).</summary>
        [HttpPost("{companyId}/validate-all")]
        [HasPermission("fbr.sandbox.run")]
        [AuthorizeCompany]
        [EnableRateLimiting("fbrSubmit")]
        public async Task<IActionResult> ValidateAll(int companyId)
            => Ok(await _service.ValidateAllAsync(companyId));

        /// <summary>Submit every demo bill to PRAL (commits IRNs).</summary>
        [HttpPost("{companyId}/submit-all")]
        [HasPermission("fbr.sandbox.run")]
        [AuthorizeCompany]
        [EnableRateLimiting("fbrSubmit")]
        public async Task<IActionResult> SubmitAll(int companyId)
            => Ok(await _service.SubmitAllAsync(companyId));

        /// <summary>Delete a single demo bill + its associated demo challan.</summary>
        [HttpDelete("{companyId}/bill/{billId}")]
        [HasPermission("fbr.sandbox.delete")]
        [AuthorizeCompany]
        public async Task<IActionResult> DeleteOne(int companyId, int billId)
        {
            var ok = await _service.DeleteOneAsync(companyId, billId);
            return ok ? NoContent() : NotFound();
        }

        /// <summary>Wipe ALL demo bills + challans for a company.</summary>
        [HttpDelete("{companyId}")]
        [HasPermission("fbr.sandbox.delete")]
        [AuthorizeCompany]
        public async Task<IActionResult> DeleteAll(int companyId)
            => Ok(new { deleted = await _service.DeleteAllAsync(companyId) });
    }
}
