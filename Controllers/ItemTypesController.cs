using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
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
        private readonly ICompanyAccessGuard _access;

        public ItemTypesController(
            IItemTypeService service,
            ITaxMappingEngine taxEngine,
            ICompanyAccessGuard access)
        {
            _service = service;
            _taxEngine = taxEngine;
            _access = access;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        /// <summary>
        /// Returns the FBR-published valid UOMs for a given HS Code, going
        /// through the tax engine (cached). Frontend uses this to narrow the
        /// UOM picker on the Item Type form to only what FBR will accept for
        /// that HS code — eliminates 0052 "invalid combination" errors at
        /// the source.
        /// </summary>
        [HttpGet("uoms-for-hs")]
        [HasAnyPermission(
            "itemtypes.manage.view",
            "challans.list.view", "challans.manage.create", "challans.manage.update",
            "salesquotes.list.view", "salesquotes.manage.create", "salesquotes.manage.update",
            "salesorders.list.view", "salesorders.manage.create", "salesorders.manage.update",
            "bills.list.view", "bills.manage.create", "bills.manage.create.standalone",
            "bills.manage.update",
            "invoices.list.view", "invoices.manage.update.itemtype",
            "invoices.manage.update.itemtype.qty", "invoices.note.create",
            "purchasebills.list.view", "purchasebills.manage.create", "purchasebills.manage.update",
            "goodsreceipts.list.view", "goodsreceipts.manage.create", "goodsreceipts.manage.update",
            "stock.dashboard.view")]
        public async Task<ActionResult<List<FbrUOMDto>>> GetUomsForHs(
            [FromQuery] int companyId, [FromQuery] string hsCode)
        {
            if (companyId <= 0 || string.IsNullOrWhiteSpace(hsCode))
                return BadRequest(new { error = "companyId and hsCode are required." });

            // Tenant scope (audit H6): this drives a PRAL call with THIS company's
            // FBR token — without the assert any user could bleed another tenant's
            // token / burn their FBR quota by passing a foreign companyId.
            await _access.AssertAccessAsync(CurrentUserId, companyId);

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
        [HasAnyPermission(
            "itemtypes.manage.view",
            "challans.list.view", "challans.manage.create", "challans.manage.update",
            "salesquotes.list.view", "salesquotes.manage.create", "salesquotes.manage.update",
            "salesorders.list.view", "salesorders.manage.create", "salesorders.manage.update",
            "bills.list.view", "bills.manage.create", "bills.manage.create.standalone",
            "bills.manage.update",
            "invoices.list.view", "invoices.manage.update.itemtype",
            "invoices.manage.update.itemtype.qty", "invoices.note.create",
            "purchasebills.list.view", "purchasebills.manage.create", "purchasebills.manage.update",
            "goodsreceipts.list.view", "goodsreceipts.manage.create", "goodsreceipts.manage.update",
            "stock.dashboard.view")]
        public async Task<IActionResult> GetFbrHints(
            [FromQuery] int companyId, [FromQuery] string hsCode)
        {
            if (companyId <= 0 || string.IsNullOrWhiteSpace(hsCode))
                return BadRequest(new { error = "companyId and hsCode are required." });

            // Tenant scope (audit H6): drives a PRAL call with this company's FBR
            // token — assert access so a foreign companyId can't bleed the token.
            await _access.AssertAccessAsync(CurrentUserId, companyId);

            var hints = await _taxEngine.GetHsCodeHintsAsync(companyId, hsCode);
            return Ok(hints);
        }

        /// <summary>
        /// The item catalog behind every line-item picker. Gated on the picker
        /// audience, not on itemtypes.manage.view - that key opens the Item
        /// Types SCREEN, and a role built to raise bills needs the list without
        /// it. The catalog itself is global (ItemType has no CompanyId), but the
        /// OPTIONAL companyId decorates each row with that company's on-hand
        /// quantity, so it is a tenant fact and is guarded as one.
        /// </summary>
        [HttpGet]
        [HasAnyPermission(
            "itemtypes.manage.view",
            "challans.list.view", "challans.manage.create", "challans.manage.update",
            "salesquotes.list.view", "salesquotes.manage.create", "salesquotes.manage.update",
            "salesorders.list.view", "salesorders.manage.create", "salesorders.manage.update",
            "bills.list.view", "bills.manage.create", "bills.manage.create.standalone",
            "bills.manage.update",
            "invoices.list.view", "invoices.manage.update.itemtype",
            "invoices.manage.update.itemtype.qty", "invoices.note.create",
            "purchasebills.list.view", "purchasebills.manage.create", "purchasebills.manage.update",
            "goodsreceipts.list.view", "goodsreceipts.manage.create", "goodsreceipts.manage.update",
            "stock.dashboard.view")]
        public async Task<ActionResult<List<ItemTypeDto>>> GetAll([FromQuery] int? companyId = null)
        {
            // Optional companyId (2026-05-12) — when present AND the
            // company has inventory tracking enabled, each DTO carries
            // an AvailableQty and the list is sorted by available stock
            // descending. Sales-side dropdowns (EditBillForm, etc.)
            // pass it so operators see "what can I sell" up top.
            //
            // Without companyId (2026-05-20): the Item Catalog admin page
            // wants ONE on-hand number per item summed across every
            // company the caller can reach — items are common across all
            // tenants of the user, so a per-company filter would zero out
            // legitimate stock that lives under a different company. We
            // aggregate across the caller's accessible-company set
            // (filtered to tracking-enabled by the stock service).
            List<ItemTypeDto> items;
            if (companyId.HasValue)
            {
                // 2026-09-21: this branch used to take the query parameter on
                // trust. AvailableQty is that company's stock on hand, so
                // passing someone else's id read their inventory - and with no
                // permission attribute at all, any authenticated user of any
                // tenant could do it. The id is a claim by the caller, never a
                // fact; the else-branch below was already right to derive the
                // set from the caller instead of believing them.
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
                items = await _service.GetAllAsync(companyId);
            }
            else
            {
                var accessible = await _access.GetAccessibleCompanyIdsAsync(CurrentUserId);
                items = await _service.GetAllAsync(
                    companyId: null,
                    aggregateAcrossCompanyIds: accessible);
            }
            return Ok(items);
        }

        /// <summary>
        /// Returns all HS codes already used by existing item types. The Item
        /// Types page uses this to hide already-saved codes from the HS Code
        /// catalog search, so users only see codes they haven't mapped yet.
        /// </summary>
        [HttpGet("saved-hscodes")]
        [HasPermission("itemtypes.manage.view")]
        public async Task<ActionResult<List<string>>> GetSavedHsCodes()
        {
            return Ok(await _service.GetSavedHsCodesAsync());
        }

        [HttpGet("{id}")]
        [HasAnyPermission(
            "itemtypes.manage.view",
            "challans.list.view", "challans.manage.create", "challans.manage.update",
            "salesquotes.list.view", "salesquotes.manage.create", "salesquotes.manage.update",
            "salesorders.list.view", "salesorders.manage.create", "salesorders.manage.update",
            "bills.list.view", "bills.manage.create", "bills.manage.create.standalone",
            "bills.manage.update",
            "invoices.list.view", "invoices.manage.update.itemtype",
            "invoices.manage.update.itemtype.qty", "invoices.note.create",
            "purchasebills.list.view", "purchasebills.manage.create", "purchasebills.manage.update",
            "goodsreceipts.list.view", "goodsreceipts.manage.create", "goodsreceipts.manage.update",
            "stock.dashboard.view")]
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
            // companyId here only says whose FBR token fetches the UOM list, so
            // an unchecked id would spend another tenant's PRAL quota on their
            // bearer - see CLAUDE.md, "Never bleed one tenant's token".
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
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
            // Same as Create: the companyId chooses whose FBR token is used.
            if (companyId.HasValue)
                await _access.AssertAccessAsync(CurrentUserId, companyId.Value);
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
