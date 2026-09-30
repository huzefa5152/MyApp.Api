using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class WithholdingTaxReceiptsController : ControllerBase
    {
        private readonly IWithholdingTaxReceiptService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<WithholdingTaxReceiptsController> _logger;

        public WithholdingTaxReceiptsController(
            IWithholdingTaxReceiptService service,
            ICompanyAccessGuard access,
            ILogger<WithholdingTaxReceiptsController> logger)
        {
            _service = service;
            _access = access;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("withholdingtax.list.view")]
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
            {
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var total = 0;
            foreach (var cid in allowed)
            {
                total += await _service.GetCountByCompanyAsync(cid);
            }
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("withholdingtax.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<WithholdingTaxReceiptDto>>> GetByCompany(int companyId)
        {
            return Ok(await _service.GetByCompanyAsync(companyId));
        }

        [HttpGet("{id}")]
        [HasPermission("withholdingtax.list.view")]
        public async Task<ActionResult<WithholdingTaxReceiptDto>> GetById(int id)
        {
            var receipt = await _service.GetByIdAsync(id);
            if (receipt == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, receipt.CompanyId);
            return Ok(receipt);
        }

        [HttpGet("{id}/print")]
        [HasPermission("withholdingtax.print.view")]
        public async Task<ActionResult<PrintWithholdingReceiptDto>> GetPrintData(int id)
        {
            var receipt = await _service.GetByIdAsync(id);
            if (receipt == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, receipt.CompanyId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("withholdingtax.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<WithholdingTaxReceiptDto>> Create(int companyId, [FromBody] WithholdingTaxReceiptDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Invalid withholding receipt operation");
                return BadRequest(new { error = "Check the customer and amount. Only the latest receipt can be deleted." });
            }
            catch (KeyNotFoundException ex)
            {
                _logger.LogWarning(ex, "Withholding receipt customer not found");
                return BadRequest(new { error = "Choose an existing customer from this company." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create withholding tax receipt failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not create the withholding tax receipt. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("withholdingtax.manage.update")]
        public async Task<ActionResult<WithholdingTaxReceiptDto>> Update(int id, [FromBody] WithholdingTaxReceiptDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Invalid withholding receipt operation");
                return BadRequest(new { error = "Check the customer and amount. Only the latest receipt can be deleted." });
            }
            catch (KeyNotFoundException ex)
            {
                _logger.LogWarning(ex, "Withholding receipt customer not found");
                return BadRequest(new { error = "Choose an existing customer from this company." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("withholdingtax.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex)
            {
                _logger.LogWarning(ex, "Invalid withholding receipt operation");
                return BadRequest(new { error = "Check the customer and amount. Only the latest receipt can be deleted." });
            }
        }
    }
}
