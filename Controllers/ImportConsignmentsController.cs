using MyApp.Api.DTOs;
using Microsoft.EntityFrameworkCore;
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
        private readonly IGdRevisionService _revisions;
        private readonly IImportProfileService _profiles;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly ILogger<ImportConsignmentsController> _logger;

        public ImportConsignmentsController(
            IImportConsignmentService consignments,
            IGdRevisionService revisions,
            IImportProfileService profiles,
            ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess,
            ILogger<ImportConsignmentsController> logger)
        {
            _consignments = consignments;
            _revisions = revisions;
            _profiles = profiles;
            _access = access;
            _divisionAccess = divisionAccess;
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>Paged list. Default order puts what is still owed in front
        /// of the operator; <paramref name="onlyOutstanding"/> narrows it to
        /// just that (Task 23).</summary>
        [HttpGet]
        [HasPermission("importcosting.consignments.view")]
        public async Task<IActionResult> GetPaged(
            [FromQuery] int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null,
            [FromQuery] bool onlyOutstanding = false)
        {
            if (companyId <= 0) return BadRequest(new { message = "Choose a company." });
            await _access.AssertAccessAsync(CurrentUserId, companyId);
            return Ok(await _consignments.GetPagedAsync(companyId, page, pageSize, onlyOutstanding));
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
        /// Correct ONE line of a recorded GD in place — the surgical
        /// alternative to deleting and re-importing the whole consignment,
        /// which a SETTLED consignment cannot do at all.
        ///
        /// Gated the same as running an import, and as deleting one: if you can
        /// create a consignment you can correct one. The company comes from the
        /// STORED row, never the caller.
        /// </summary>
        // -- Revise a recorded GD from one sheet (2026-11-27) -----------------

        /// <summary>
        /// The recorded GD as a workbook in the upload layout: the file a
        /// consultant edits and uploads back with Revise from sheet. Company
        /// from the STORED consignment.
        /// </summary>
        [HttpGet("{id:int}/sheet")]
        [HasPermission("importcosting.consignments.view")]
        public async Task<IActionResult> Sheet(int id)
        {
            var file = await _revisions.ExportAsync(id);
            if (file == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, file.Value.CompanyId);
            return File(file.Value.Bytes,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file.Value.FileName);
        }

        /// <summary>
        /// Reads a revised sheet for this GD and says what it would change, add
        /// and remove. Writes nothing. The layout is the built-in costing
        /// layout unless a saved one is named.
        /// </summary>
        [HttpPost("{id:int}/revise/preview")]
        [HasPermission("importcosting.sheet.run")]
        [RequestSizeLimit(ExcelUploadValidator.MaxBytes)]
        public async Task<IActionResult> RevisePreview(int id, [FromForm] IFormFile file, [FromQuery] int? profileId)
        {
            var existing = await _consignments.GetDetailAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);

            var validated = await ExcelUploadValidator.ValidateAsync(file, HttpContext.RequestAborted);
            if (!validated.Ok) return BadRequest(new { message = validated.Error });

            var mappingJson = Helpers.ExcelImport.GdCostingLayout.MappingJson;
            int? profileVersion = null;
            if (profileId.HasValue)
            {
                var profile = await _profiles.GetAsync(profileId.Value);
                if (profile == null || (profile.CompanyId != null && profile.CompanyId != existing.CompanyId)
                    || !string.Equals(profile.Kind, Models.ImportKinds.GdCosting, StringComparison.OrdinalIgnoreCase))
                    return NotFound(new { message = "That layout does not exist." });
                mappingJson = profile.MappingJson;
                profileVersion = profile.CurrentVersion;
            }

            try
            {
                return Ok(await _revisions.PreviewAsync(
                    id, validated.Bytes, validated.Extension, validated.FileName, validated.Sha256,
                    mappingJson, profileId, profileVersion));
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Reading a revision sheet for import consignment {Id} failed", id);
                return StatusCode(500, new { message = "The file could not be read. Please check it and try again." });
            }
        }

        /// <summary>
        /// Applies a reviewed revision: every changed, new and removed line in
        /// one transaction, or none. Same write scope as a single-line
        /// correction.
        /// </summary>
        [HttpPost("{id:int}/revise/commit")]
        [HasPermission("importcosting.sheet.run")]
        public async Task<IActionResult> ReviseCommit(int id, [FromBody] DTOs.GdRevisionCommitDto dto)
        {
            var existing = await _consignments.GetDetailAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, existing.CompanyId, null);

            try
            {
                return Ok(await _revisions.CommitAsync(id, dto, CurrentUserId));
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Revising import consignment {Id} failed", id);
                return StatusCode(500, new { message = "The GD could not be revised. Nothing was changed." });
            }
        }

        [HttpPut("{id:int}/lines/{lineId:int}")]
        [HasPermission("importcosting.sheet.run")]
        public async Task<IActionResult> UpdateLine(
            int id, int lineId, [FromBody] DTOs.UpdateImportConsignmentLineDto dto)
        {
            var existing = await _consignments.GetDetailAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            // A correction moves company-level inventory and the ledger, the
            // same write scope the commit and the delete assert (policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, existing.CompanyId, null);

            try
            {
                return Ok(await _consignments.UpdateLineAsync(id, lineId, dto, CurrentUserId));
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Correcting line {LineId} of import consignment {Id} failed", lineId, id);
                return StatusCode(500, new { message = "The line could not be corrected. Nothing was changed." });
            }
        }

        /// <summary>
        /// The correction path: undoes exactly what the commit did (the cost
        /// it wrote, the balances it created, the journal entry it posted), or
        /// refuses the whole thing if any part cannot be safely undone.
        /// Gated the same as running an import — if you can create one, you
        /// can unwind one.
        /// </summary>
        /// <summary>GD-level charges (2026-10-05). Company from the STORED
        /// consignment, like every route here.</summary>
        [HttpGet("{id:int}/charges")]
        [HasPermission("importcosting.consignments.view")]
        public async Task<IActionResult> GetCharges(int id)
        {
            var guard = await GuardAsync(id);
            if (guard != null) return guard;
            return Ok(await _consignments.GetChargesAsync(id));
        }

        [HttpPost("{id:int}/charges")]
        [HasPermission("importcosting.sheet.run")]
        public async Task<IActionResult> AddCharge(int id, [FromBody] CreateImportConsignmentChargeDto dto)
        {
            var guard = await GuardAsync(id);
            if (guard != null) return guard;
            try { return Ok(await _consignments.AddChargeAsync(id, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
            catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        }

        [HttpDelete("{id:int}/charges/{chargeId:int}")]
        [HasPermission("importcosting.sheet.run")]
        public async Task<IActionResult> DeleteCharge(int id, int chargeId)
        {
            var guard = await GuardAsync(id);
            if (guard != null) return guard;
            try { return Ok(await _consignments.DeleteChargeAsync(id, chargeId)); }
            catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
            catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        }

        /// <summary>Resolves the company from the stored consignment and asserts
        /// the caller may reach it (and every division of it, as a GD is
        /// company-wide).</summary>
        private async Task<IActionResult?> GuardAsync(int id)
        {
            var db = HttpContext.RequestServices.GetRequiredService<MyApp.Api.Data.AppDbContext>();
            var companyId = await db.ImportConsignments.AsNoTracking().Where(c => c.Id == id)
                .Select(c => (int?)c.CompanyId).FirstOrDefaultAsync();
            if (companyId == null) return NotFound(new { message = "That consignment no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            if (await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId.Value) != null)
                return StatusCode(403, new { message = "GD charges cover the whole GD, so they need access to every division." });
            return null;
        }

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
