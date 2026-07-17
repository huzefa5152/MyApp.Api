using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>Purchase (supplier-side) debit notes. Read + delete; rows are
    /// created by the Manager.io import (supplier debit notes have no home on the
    /// sales-side note screens, which are client-based).</summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class PurchaseDebitNotesController : ControllerBase
    {
        private readonly IPurchaseDebitNoteService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;

        public PurchaseDebitNotesController(
            IPurchaseDebitNoteService service, ICompanyAccessGuard access, IDivisionAccessGuard divisionAccess)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
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
        [HasPermission("purchasedebitnotes.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<PurchaseDebitNoteDto>>> GetByCompany(int companyId)
        {
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _service.GetByCompanyAsync(companyId, divScope));
        }

        [HttpGet("{id}")]
        [HasPermission("purchasedebitnotes.list.view")]
        public async Task<ActionResult<PurchaseDebitNoteDto>> GetById(int id)
        {
            var note = await _service.GetByIdAsync(id);
            if (note == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, note.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, note.CompanyId, note.DivisionId);
            return Ok(note);
        }

        [HttpGet("{id}/print")]
        [HasPermission("purchasedebitnotes.print.view")]
        public async Task<ActionResult<PrintPurchaseDebitNoteDto>> GetPrintData(int id)
        {
            var note = await _service.GetByIdAsync(id);
            if (note == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, note.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, note.CompanyId, note.DivisionId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }

        [HttpPost]
        [HasPermission("purchasedebitnotes.manage.create")]
        public async Task<ActionResult<PurchaseDebitNoteDto>> Create([FromBody] CreatePurchaseDebitNoteDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Division-restricted users must tag the note with one of their
            // divisions (write-assert also rejects null → policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, dto.DivisionId);
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
            // Assert against the STORED company/division — body fields can be forged.
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
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
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var ok = await _service.DeleteAsync(id);
            return ok ? NoContent() : NotFound();
        }
    }
}
