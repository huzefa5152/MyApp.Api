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
    public class PurchaseDebitNotesController : ControllerBase
    {
        private readonly IPurchaseDebitNoteService _service;
        private readonly ICompanyAccessGuard _access;


        public PurchaseDebitNotesController(
            IPurchaseDebitNoteService service, ICompanyAccessGuard access)
        {
            _service = service;
            _access = access;

        }

        private int CurrentUserId =>
            int.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("purchasedebitnotes.list.view")]
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
        [HasPermission("purchasedebitnotes.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<PurchaseDebitNoteDto>>> GetByCompany(int companyId)
        {

            return Ok(await _service.GetByCompanyAsync(companyId));
        }

        [HttpGet("{id}")]
        [HasPermission("purchasedebitnotes.list.view")]
        public async Task<ActionResult<PurchaseDebitNoteDto>> GetById(int id)
        {
            var note = await _service.GetByIdAsync(id);
            if (note == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, note.CompanyId);

            return Ok(note);
        }

        [HttpGet("{id}/print")]
        [HasPermission("purchasedebitnotes.print.view")]
        public async Task<ActionResult<PrintPurchaseDebitNoteDto>> GetPrintData(int id)
        {
            var note = await _service.GetByIdAsync(id);
            if (note == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, note.CompanyId);

            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }

        [HttpPost]
        [HasPermission("purchasedebitnotes.manage.create")]
        public async Task<ActionResult<PurchaseDebitNoteDto>> Create([FromBody] CreatePurchaseDebitNoteDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);

            try
            {
                var created = await _service.CreateAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}")]
        [HasPermission("purchasedebitnotes.manage.update")]
        public async Task<ActionResult<PurchaseDebitNoteDto>> Update(int id, [FromBody] UpdatePurchaseDebitNoteDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);

            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (KeyNotFoundException ex) { return NotFound(new { error = ex.Message }); }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpDelete("{id}")]
        [HasPermission("purchasedebitnotes.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);

            var ok = await _service.DeleteAsync(id);
            return ok ? NoContent() : NotFound();
        }
    }
}
