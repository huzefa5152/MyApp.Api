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
    public class InvoicesController : ControllerBase
    {
        private readonly IInvoiceService _service;
        private readonly int _defaultPageSize;

        public InvoicesController(IInvoiceService service, IConfiguration configuration)
        {
            _service = service;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        [HttpGet("count")]
        [HasPermission("invoices.list.view")]
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            return Ok(await _service.GetTotalCountAsync());
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("invoices.list.view")]
        public async Task<ActionResult<List<InvoiceDto>>> GetByCompany(int companyId)
        {
            var invoices = await _service.GetByCompanyAsync(companyId);
            return Ok(invoices);
        }

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("invoices.list.view")]
        public async Task<ActionResult<PagedResult<InvoiceDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] int? clientId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = pageSize ?? _defaultPageSize;
            var result = await _service.GetPagedByCompanyAsync(
                companyId, page, size, search, clientId, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("invoices.list.view")]
        public async Task<ActionResult<InvoiceDto>> GetById(int id)
        {
            var invoice = await _service.GetByIdAsync(id);
            if (invoice == null) return NotFound();
            return Ok(invoice);
        }

        /// <summary>
        /// Flat search across a company's bill lines — answers "what rate did
        /// I bill for this item last time, and to whom?". Filter by an
        /// ItemType id (preferred — exact catalog match) OR by free-text
        /// search (matches description and ItemType.Name). Optional client/
        /// date filters narrow further. Result also carries avg/min/max unit
        /// price across the full filtered set.
        /// </summary>
        [HttpGet("company/{companyId}/item-rate-history")]
        [HasPermission("itemratehistory.view")]
        public async Task<ActionResult<ItemRateHistoryResultDto>> GetItemRateHistory(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] int? itemTypeId = null,
            [FromQuery] string? search = null,
            [FromQuery] int? clientId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = pageSize ?? _defaultPageSize;
            var result = await _service.GetItemRateHistoryAsync(
                companyId, page, size, itemTypeId, search, clientId, dateFrom, dateTo);
            return Ok(result);
        }

        /// <summary>
        /// Per-item last billed rate for every line on a challan. Powers the
        /// "Generate Bill" shortcut's auto-fill behaviour. Gated by the same
        /// invoices.manage.create permission required to create a bill — if
        /// you can't make a bill, you don't need rate suggestions.
        /// </summary>
        [HttpGet("company/{companyId}/last-rates")]
        [HasPermission("invoices.manage.create")]
        public async Task<ActionResult<List<LastRateDto>>> GetLastRatesForChallan(
            int companyId, [FromQuery] int challanId)
        {
            if (challanId <= 0)
                return BadRequest(new { error = "challanId is required." });
            var rows = await _service.GetLastRatesForChallanAsync(companyId, challanId);
            return Ok(rows);
        }

        /// <summary>
        /// Sale bills that need procurement — picker for the "Purchase
        /// Against Sale Bill" flow. Returns only bills that have at least
        /// one HSCode-empty line with remaining qty AND every line on the
        /// bill has an ItemTypeId set (so the procurement form can group
        /// cleanly).
        /// </summary>
        [HttpGet("company/{companyId}/awaiting-purchase")]
        [HasPermission("purchasebills.manage.create")]
        public async Task<ActionResult<List<AwaitingPurchaseInvoiceDto>>> GetAwaitingPurchase(int companyId)
            => Ok(await _service.GetAwaitingPurchaseAsync(companyId));

        /// <summary>
        /// Per-line procurement template for one sale bill — HSCode-empty
        /// lines grouped by ItemType, with sold/procured/remaining qty.
        /// Drives the PurchaseBillForm in "Purchase Against Sale" mode.
        /// </summary>
        [HttpGet("{invoiceId}/purchase-template")]
        [HasPermission("purchasebills.manage.create")]
        public async Task<ActionResult<PurchaseTemplateDto>> GetPurchaseTemplate(int invoiceId)
        {
            var dto = await _service.GetPurchaseTemplateAsync(invoiceId);
            if (dto == null) return NotFound();
            return Ok(dto);
        }

        [HttpPost]
        [HasPermission("invoices.manage.create")]
        public async Task<ActionResult<InvoiceDto>> Create([FromBody] CreateInvoiceDto dto)
        {
            try
            {
                if (dto.ChallanIds == null || !dto.ChallanIds.Any())
                    return BadRequest(new { error = "At least one challan must be selected." });
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item with unit price is required." });
                if (dto.Items.Any(i => i.UnitPrice <= 0))
                    return BadRequest(new { error = "All items must have a positive unit price." });
                if (dto.GSTRate < 0 || dto.GSTRate > 100)
                    return BadRequest(new { error = "GST rate must be between 0 and 100." });

                var created = await _service.CreateAsync(dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (KeyNotFoundException ex)
            {
                return NotFound(new { error = ex.Message });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("invoices.manage.update")]
        public async Task<ActionResult<InvoiceDto>> Update(int id, [FromBody] UpdateInvoiceDto dto)
        {
            try
            {
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item is required." });
                if (dto.Items.Any(i => i.UnitPrice < 0))
                    return BadRequest(new { error = "Unit price cannot be negative." });
                if (dto.Items.Any(i => i.Quantity <= 0))
                    return BadRequest(new { error = "Quantity must be greater than zero." });
                if (dto.GSTRate < 0 || dto.GSTRate > 100)
                    return BadRequest(new { error = "GST rate must be between 0 and 100." });

                var updated = await _service.UpdateAsync(id, dto);
                if (updated == null) return NotFound(new { error = "Bill not found." });
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Narrow edit path — re-classify each line by picking a different
        /// ItemType. Service re-derives HS Code / UOM / Sale Type from the
        /// catalog; every other field on the bill is left alone.
        ///
        /// RBAC: requires `invoices.manage.update.itemtype`. Users with the
        /// broader `invoices.manage.update` permission can use this endpoint
        /// too (a superset has access to the narrow flow), but operationally
        /// they'd just hit PUT /{id} for a full edit.
        /// </summary>
        [HttpPatch("{id}/itemtypes")]
        [HasPermission("invoices.manage.update.itemtype")]
        public async Task<ActionResult<InvoiceDto>> UpdateItemTypes(
            int id, [FromBody] UpdateInvoiceItemTypesDto dto)
        {
            try
            {
                // allowQuantityEdit=false — qty fields in payload are ignored
                var updated = await _service.UpdateItemTypesAsync(id, dto, allowQuantityEdit: false);
                if (updated == null) return NotFound(new { error = "Bill not found." });
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Slightly broader narrow edit — Item Type AND Quantity per line.
        /// Everything else on the bill (price / desc / GST / dates / payment
        /// terms / doc type / SRO) stays read-only. Decimal validation
        /// applies: fractional qty rejected for integer-only UOMs.
        ///
        /// RBAC: requires `invoices.manage.update.itemtype.qty`. Strict
        /// superset of `invoices.manage.update.itemtype` — the startup
        /// migration in Program.cs auto-grants it to anyone holding the
        /// broader `invoices.manage.update`.
        /// </summary>
        [HttpPatch("{id}/itemtypes-and-qty")]
        [HasPermission("invoices.manage.update.itemtype.qty")]
        public async Task<ActionResult<InvoiceDto>> UpdateItemTypesAndQty(
            int id, [FromBody] UpdateInvoiceItemTypesDto dto)
        {
            try
            {
                var updated = await _service.UpdateItemTypesAsync(id, dto, allowQuantityEdit: true);
                if (updated == null) return NotFound(new { error = "Bill not found." });
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("invoices.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            try
            {
                var deleted = await _service.DeleteAsync(id);
                if (!deleted) return NotFound(new { error = "Bill not found." });
                return Ok(new { message = "Bill deleted and challans reverted." });
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>
        /// Flip the FBR-exclusion flag on a bill. Excluded bills are skipped
        /// by Validate All / Submit All; per-bill validate/submit still work.
        /// Returns the updated DTO so the UI can re-render without a refetch.
        ///
        /// Gated by the dedicated invoices.fbr.exclude permission rather
        /// than the broader invoices.manage.update so a role can be granted
        /// the toggle without also gaining edit rights on prices / items /
        /// dates of the bill itself.
        /// </summary>
        [HttpPut("{id}/fbr-excluded")]
        [HasPermission("invoices.fbr.exclude")]
        public async Task<ActionResult<InvoiceDto>> SetFbrExcluded(int id, [FromBody] SetFbrExcludedRequest body)
        {
            var updated = await _service.SetFbrExcludedAsync(id, body.Excluded);
            if (updated == null) return NotFound(new { error = "Bill not found." });
            return Ok(updated);
        }

        public class SetFbrExcludedRequest
        {
            public bool Excluded { get; set; }
        }

        [HttpGet("{id}/print/bill")]
        [HasPermission("invoices.print.view")]
        public async Task<ActionResult<PrintBillDto>> GetPrintBill(int id)
        {
            var dto = await _service.GetPrintBillAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }

        [HttpGet("{id}/print/tax-invoice")]
        [HasPermission("invoices.print.view")]
        public async Task<ActionResult<PrintTaxInvoiceDto>> GetPrintTaxInvoice(int id)
        {
            var dto = await _service.GetPrintTaxInvoiceAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }
    }
}
