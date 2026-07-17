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
