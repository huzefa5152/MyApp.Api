using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Implementations;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Letters of credit (2026-10-05): the bank instrument an importer pays a
    /// foreign supplier with, and the GDs that cleared goods shipped against it.
    /// Record-keeping only -- nothing here posts to the ledger. Every by-id route
    /// resolves the company from the STORED row, never the request. The work
    /// itself is <see cref="ImportLcService"/>, shared with the MCP tools.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/import-lcs")]
    public class ImportLcsController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly ICompanyAccessGuard _access;
        private readonly ImportLcService _lcs;

        public ImportLcsController(AppDbContext db, ICompanyAccessGuard access, ImportLcService lcs)
        {
            _db = db;
            _access = access;
            _lcs = lcs;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("company/{companyId}")]
        [HasPermission("importcosting.lc.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<ImportLcDto>>> List(int companyId) => Ok(await _lcs.ListAsync(companyId));

        [HttpPost("company/{companyId}")]
        [HasPermission("importcosting.lc.manage")]
        [AuthorizeCompany]
        public async Task<IActionResult> Create(int companyId, [FromBody] ImportLcDto dto)
        {
            try { return Ok(await _lcs.CreateAsync(companyId, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
        }

        [HttpPut("{id:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Update(int id, [FromBody] ImportLcDto dto)
        {
            var companyId = await _lcs.CompanyOfAsync(id);
            if (companyId == null) return NotFound(new { message = "That LC no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            try { return Ok(await _lcs.UpdateAsync(id, dto)); }
            catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
            catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        }

        /// <summary>Removes an LC. Linked GDs are unlinked, never deleted.</summary>
        [HttpDelete("{id:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Delete(int id)
        {
            var companyId = await _lcs.CompanyOfAsync(id);
            if (companyId == null) return NotFound(new { message = "That LC no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            try { await _lcs.DeleteAsync(id); }
            catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
            return NoContent();
        }

        /// <summary>Links a GD to an LC (or unlinks it with null) and records its bill of lading.</summary>
        [HttpPut("consignment/{consignmentId:int}")]
        [HasPermission("importcosting.lc.manage")]
        public async Task<IActionResult> Link(int consignmentId, [FromBody] ImportLcLinkDto dto)
        {
            var companyId = await _db.ImportConsignments.AsNoTracking().Where(x => x.Id == consignmentId)
                .Select(x => (int?)x.CompanyId).FirstOrDefaultAsync();
            if (companyId == null) return NotFound(new { message = "That consignment no longer exists." });
            await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
            try
            {
                var (id, lcId, bl) = await _lcs.LinkAsync(consignmentId, dto);
                return Ok(new { consignmentId = id, lcId, blNumber = bl });
            }
            catch (InvalidOperationException ex) { return BadRequest(new { message = ex.Message }); }
            catch (KeyNotFoundException ex) { return NotFound(new { message = ex.Message }); }
        }
    }
}
