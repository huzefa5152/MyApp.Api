using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// The read + correction side of the GD costing import (Task 21):
    /// <c>Controllers/SpreadsheetImportController.cs</c>'s <c>gd-costing/*</c>
    /// routes WRITE a consignment; these routes are what let an operator look
    /// at what was written, and undo it if it was wrong.
    ///
    /// Every route resolves the company from the STORED consignment and
    /// asserts against that — never from a caller-supplied company id, so a
    /// forged id cannot be used to view or delete another tenant's row.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-consignments")]
    public class ImportConsignmentsController : ControllerBase
    {
        private readonly IImportConsignmentService _consignments;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly ILogger<ImportConsignmentsController> _logger;

        public ImportConsignmentsController(
            IImportConsignmentService consignments,
            ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess,
            ILogger<ImportConsignmentsController> logger)
        {
            _consignments = consignments;
            _access = access;
            _divisionAccess = divisionAccess;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>Paged list, newest first.</summary>
        [HttpGet]
        [HasPermission("importcosting.consignments.view")]
        public async Task<IActionResult> GetPaged([FromQuery] int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null)
        {
            if (companyId <= 0) return BadRequest(new { message = "Choose a company." });
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _consignments.GetPagedAsync(companyId, page, pageSize));
        }

        /// <summary>One consignment with its lines. The company is read from
        /// the stored row, never from the caller — a forged id belonging to
        /// another tenant reads as 403, not a leaked 200.</summary>
        [HttpGet("{id:int}")]
        [HasPermission("importcosting.consignments.view")]
        public async Task<IActionResult> GetById(int id)
        {
            var dto = await _consignments.GetDetailAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        /// <summary>
        /// The correction path: undoes exactly what the commit did (the cost
        /// it wrote, the balances it created, the journal entry it posted), or
        /// refuses the whole thing if any part cannot be safely undone.
        /// Gated the same as running an import — if you can create one, you
        /// can unwind one.
        /// </summary>
        [HttpDelete("{id:int}")]
        [HasPermission("importcosting.sheet.run")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _consignments.GetDetailAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            // Undoing a consignment changes company-level inventory state
            // (opening balances, GL) -- the same write guard the commit and
            // the Opening Balances screen apply (CLAUDE.md §4 / policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, existing.CompanyId, null);

            try
            {
                var result = await _consignments.DeleteAsync(id, CurrentUserId);
                return Ok(result);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Deleting import consignment {Id} failed", id);
                return StatusCode(500, new { message = "The consignment could not be deleted. Nothing was changed." });
            }
        }
    }
}
