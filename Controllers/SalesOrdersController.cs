using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class SalesOrdersController : ControllerBase
    {
        private readonly ISalesOrderService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly int _defaultPageSize;
        private readonly ILogger<SalesOrdersController> _logger;

        public SalesOrdersController(ISalesOrderService service, ICompanyAccessGuard access,
            IConfiguration configuration, ILogger<SalesOrdersController> logger)
        {
            _service = service;
            _access = access;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
            _logger = logger;
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("salesorders.list.view")]
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
                total += await _service.GetCountByCompanyAsync(cid);
            return Ok(total);
        }

        [HttpGet("company/{companyId}")]
        [HasPermission("salesorders.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<SalesOrderDto>>> GetByCompany(int companyId)
            => Ok(await _service.GetByCompanyAsync(companyId));

        [HttpGet("company/{companyId}/open")]
        [HasPermission("salesorders.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<SalesOrderDto>>> GetOpenByCompany(int companyId)
            => Ok(await _service.GetOpenByCompanyAsync(companyId));

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("salesorders.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<SalesOrderDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] string? status = null,
            [FromQuery] int? clientId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            var result = await _service.GetPagedByCompanyAsync(
                companyId, clampedPage, size, search, status, clientId, dateFrom, dateTo);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("salesorders.list.view")]
        public async Task<ActionResult<SalesOrderDto>> GetById(int id)
        {
            var order = await _service.GetByIdAsync(id);
            if (order == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, order.CompanyId);
            return Ok(order);
        }

        [HttpPost("company/{companyId}")]
        [HasPermission("salesorders.manage.create")]
        [AuthorizeCompany]
        public async Task<ActionResult<SalesOrderDto>> Create(int companyId, [FromBody] SalesOrderDto dto)
        {
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create sales order failed for company {CompanyId}", companyId);
                return StatusCode(500, new { error = "Could not create the sales order. Please try again." });
            }
        }

        [HttpPut("{id}")]
        [HasPermission("salesorders.manage.update")]
        public async Task<ActionResult<SalesOrderDto>> Update(int id, [FromBody] SalesOrderDto dto)
        {
            // Load the stored entity and assert access against its CompanyId —
            // never trust dto.CompanyId from the body (CLAUDE.md tenant guard).
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        [HttpPut("{id}/status")]
        [HasPermission("salesorders.manage.update")]
        public async Task<IActionResult> SetStatus(int id, [FromBody] SetStatusDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.SetStatusAsync(id, dto.Status);
                return ok ? Ok(new { message = $"Order marked {dto.Status}." }) : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>
        /// Create a delivery challan that fulfils this order. Gated by the
        /// challan-create permission since that's the artifact being produced.
        /// </summary>
        [HttpPost("{id}/create-challan")]
        [HasPermission("challans.manage.create")]
        public async Task<ActionResult<DeliveryChallanDto>> CreateChallan(int id, [FromBody] CreateChallanFromOrderDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var challan = await _service.CreateChallanFromOrderAsync(id, dto);
                return Ok(challan);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException) { return NotFound(); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create challan from sales order {OrderId} failed", id);
                return StatusCode(500, new { error = "Could not create the challan from this order. Please try again." });
            }
        }

        [HttpDelete("{id}")]
        [HasPermission("salesorders.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        /// <summary>
        /// The delivery challans raised against this order, for the View /
        /// drill-down ("how many challans, what did each deliver").
        /// </summary>
        [HttpGet("{id}/challans")]
        [HasPermission("salesorders.list.view")]
        public async Task<ActionResult<List<SalesOrderChallanDto>>> GetChallans(int id)
        {
            var order = await _service.GetByIdAsync(id);
            if (order == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, order.CompanyId);
            return Ok(await _service.GetChallansForOrderAsync(id));
        }

        /// <summary>
        /// Prefill for "create a bill from this order" (FBR-off standalone
        /// billing): header + lines with server-resolved unit prices (source
        /// quote first, then last billed rate). Gated by the bill-create
        /// permissions since billing price history is what it exposes.
        /// </summary>
        [HttpGet("{id}/invoice-prefill")]
        [HasAnyPermission("bills.manage.create", "bills.manage.create.standalone")]
        public async Task<ActionResult<SalesOrderInvoicePrefillDto>> GetInvoicePrefill(int id)
        {
            var dto = await _service.GetInvoicePrefillAsync(id);
            if (dto == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        /// <summary>
        /// Challans that can be attached to this order — unlinked, unbilled,
        /// non-cancelled deliveries for the order's client (e.g. No-PO challans
        /// raised before the PO arrived).
        /// </summary>
        [HttpGet("{id}/attachable-challans")]
        [HasPermission("salesorders.list.view")]
        public async Task<ActionResult<List<AttachableChallanDto>>> GetAttachableChallans(int id)
        {
            var order = await _service.GetByIdAsync(id);
            if (order == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, order.CompanyId);
            return Ok(await _service.GetAttachableChallansAsync(id));
        }

        /// <summary>
        /// Attach an existing challan to this order (map its lines onto the
        /// ordered lines, adopt the order's PO). Gated by the challan-update
        /// permission since it mutates the challan's linkage / PO / status.
        /// </summary>
        [HttpPost("{id}/attach-challan")]
        [HasPermission("challans.manage.update")]
        public async Task<ActionResult<SalesOrderDto>> AttachChallan(int id, [FromBody] AttachChallanRequestDto dto)
        {
            var order = await _service.GetByIdAsync(id);
            if (order == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, order.CompanyId);
            try
            {
                var updated = await _service.AttachChallanAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (KeyNotFoundException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Attach challan {ChallanId} to sales order {OrderId} failed", dto?.ChallanId, id);
                return StatusCode(500, new { error = "Could not attach the challan to this order. Please try again." });
            }
        }

        [HttpGet("{id}/print")]
        [HasPermission("salesorders.print.view")]
        public async Task<ActionResult<PrintOrderDto>> GetPrintData(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            var dto = await _service.GetPrintDataAsync(id);
            return dto == null ? NotFound() : Ok(dto);
        }
    }
}
