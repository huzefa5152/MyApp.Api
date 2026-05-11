using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;
using MyApp.Api.Services.Tax;

namespace MyApp.Api.Controllers
{
    // Item types are used by autocomplete widgets on challan/invoice forms,
    // so READ endpoints are open to any authenticated user. WRITE endpoints
    // (catalog management) require explicit itemtypes.manage.* permissions.
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class ItemTypesController : ControllerBase
    {
        private readonly IItemTypeService _service;
        private readonly ITaxMappingEngine _taxEngine;

        public ItemTypesController(IItemTypeService service, ITaxMappingEngine taxEngine)
        {
            _service = service;
            _taxEngine = taxEngine;
        }

        /// <summary>
        /// Returns the FBR-published valid UOMs for a given HS Code, going
        /// through the tax engine (cached). Frontend uses this to narrow the
        /// UOM picker on the Item Type form to only what FBR will accept for
        /// that HS code — eliminates 0052 "invalid combination" errors at
        /// the source.
        /// </summary>
        [HttpGet("uoms-for-hs")]
        public async Task<ActionResult<List<FbrUOMDto>>> GetUomsForHs(
            [FromQuery] int companyId, [FromQuery] string hsCode)
        {
            if (companyId <= 0 || string.IsNullOrWhiteSpace(hsCode))
                return BadRequest(new { error = "companyId and hsCode are required." });

            var uoms = await _taxEngine.GetValidUomsForHsCodeAsync(companyId, hsCode);
            return Ok(uoms);
        }

        /// <summary>
        /// One-shot suggestion endpoint for the Item Type form. Operator types
        /// an HS Code → backend returns valid UOMs, suggested default UOM,
        /// suggested sale type + rate, and live FBR rate options for the
        /// company's province + today. The form uses this to pre-fill UOM
        /// and Sale Type and to show "common rate: X%" guidance — so the
        /// operator never wonders "is 18 % right for this HS code?".
        /// </summary>
        [HttpGet("fbr-hints")]
        public async Task<IActionResult> GetFbrHints(
            [FromQuery] int companyId, [FromQuery] string hsCode)
        {
            if (companyId <= 0 || string.IsNullOrWhiteSpace(hsCode))
                return BadRequest(new { error = "companyId and hsCode are required." });

            var hints = await _taxEngine.GetHsCodeHintsAsync(companyId, hsCode);
            return Ok(hints);
        }

        [HttpGet]
        public async Task<ActionResult<List<ItemTypeDto>>> GetAll([FromQuery] int? companyId = null)
        {
            // Optional companyId (2026-05-12) — when present AND the
            // company has inventory tracking enabled, each DTO carries
            // an AvailableQty and the list is sorted by available stock
            // descending. Sales-side dropdowns (EditBillForm, etc.)
            // pass it so operators see "what can I sell" up top; admin
            // pages call without it for the legacy alpha sort.
            var items = await _service.GetAllAsync(companyId);
            return Ok(items);
        }

        /// <summary>
        /// Returns all HS codes already used by existing item types. The Item
        /// Types page uses this to hide already-saved codes from the HS Code
        /// catalog search, so users only see codes they haven't mapped yet.
        /// </summary>
        [HttpGet("saved-hscodes")]
        public async Task<ActionResult<List<string>>> GetSavedHsCodes()
        {
            return Ok(await _service.GetSavedHsCodesAsync());
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<ItemTypeDto>> GetById(int id)
        {
            var item = await _service.GetByIdAsync(id);
            if (item == null) return NotFound();
            return Ok(item);
        }

        // Optional ?companyId= triggers the tax engine to back-fill UOM from
        // FBR's HS_UOM endpoint when the operator left UOM blank. The company
        // is just the source of the FBR token — ItemTypes are global.
        [HttpPost]
        [HasPermission("itemtypes.manage.create")]
        public async Task<ActionResult<ItemTypeDto>> Create(
            [FromBody] ItemTypeDto dto, [FromQuery] int? companyId = null)
        {
            try
            {
                var created = await _service.CreateAsync(dto, companyId);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("itemtypes.manage.update")]
        public async Task<ActionResult<ItemTypeDto>> Update(
            int id, [FromBody] ItemTypeDto dto, [FromQuery] int? companyId = null)
        {
            try
            {
                var updated = await _service.UpdateAsync(id, dto, companyId);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("itemtypes.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                await _service.DeleteAsync(id);
                return NoContent();
            }
            catch (KeyNotFoundException)
            {
                return NotFound();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { message = ex.Message });
            }
        }
    }
}
