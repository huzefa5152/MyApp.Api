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
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly ILogger<WithholdingTaxReceiptsController> _logger;

        public WithholdingTaxReceiptsController(
            IWithholdingTaxReceiptService service,
            ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess,
            ILogger<WithholdingTaxReceiptsController> logger)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
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
                var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId.Value);
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value, divScope));
            }
            var allowed = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
            var total = 0;
            foreach (var cid in allowed)
            {
                var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, cid);
                total += await _service.GetCountByCompanyAsync(cid, divScope);
            }
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("withholdingtax.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<WithholdingTaxReceiptDto>>> GetByCompany(int companyId)
        {
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _service.GetByCompanyAsync(companyId, divScope));
        }

        [HttpGet("{id}")]
        [HasPermission("withholdingtax.list.view")]
        public async Task<ActionResult<WithholdingTaxReceiptDto>> GetById(int id)
        {
            var receipt = await _service.GetByIdAsync(id);
            if (receipt == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, receipt.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, receipt.CompanyId, receipt.DivisionId);
            return Ok(receipt);
        }

        [HttpGet("{id}/print")]
        [HasPermission("withholdingtax.print.view")]
        public async Task<ActionResult<PrintWithholdingReceiptDto>> GetPrintData(int id)
        {
            var receipt = await _service.GetByIdAsync(id);
            if (receipt == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, receipt.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, receipt.CompanyId, receipt.DivisionId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("withholdingtax.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<WithholdingTaxReceiptDto>> Create(int companyId, [FromBody] WithholdingTaxReceiptDto dto)
        {
            // Division-restricted users must tag the receipt with one of their
            // divisions (write-assert also rejects null → policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, companyId, dto.DivisionId);
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException ex) { return BadRequest(new { error = ex.Message }); }
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
            // Division is immutable on update, so the read-assert on the stored
            // division is the full gate.
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id}")]
        [HasPermission("withholdingtax.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }
    }
}
