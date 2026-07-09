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
    /// <summary>
    /// Purchase-side counterpart of <see cref="InvoicesController"/>. Records
    /// supplier invoices (with their IRN), emits Stock IN movements when
    /// inventory tracking is on, and powers the Purchase Bills page.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class PurchaseBillsController : ControllerBase
    {
        private readonly IPurchaseBillService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly IDivisionAccessGuard _divisionAccess;
        private readonly int _defaultPageSize;

        public PurchaseBillsController(IPurchaseBillService service, ICompanyAccessGuard access,
            IDivisionAccessGuard divisionAccess, IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _divisionAccess = divisionAccess;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        [HttpGet("count")]
        [HasPermission("purchasebills.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<int>> GetCount([FromQuery] int companyId)
        {
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _service.GetCountByCompanyAsync(companyId, divScope));
        }

        /// <summary>Purchase-bill count per supplier (supplierId → count) — powers
        /// the clickable count on the Suppliers page.</summary>
        [HttpGet("company/{companyId}/counts-by-supplier")]
        [HasPermission("purchasebills.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<Dictionary<int, int>>> GetCountsBySupplier(int companyId)
        {
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            return Ok(await _service.GetCountsBySupplierAsync(companyId, divScope));
        }

        [HttpGet("company/{companyId}/paged")]
        [HasPermission("purchasebills.list.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<PagedResult<PurchaseBillDto>>> GetPagedByCompany(
            int companyId,
            [FromQuery] int page = 1,
            [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null,
            [FromQuery] int? supplierId = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] int? divisionId = null)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            // Division RBAC: an explicit divisionId filter must be one the
            // caller can access; without a filter, restricted users get their
            // scope applied inside the query (company-level rows included).
            if (divisionId.HasValue)
                await _divisionAccess.AssertAccessAsync(CurrentUserId, companyId, divisionId.Value);
            var divScope = await _divisionAccess.GetAccessibleDivisionIdsAsync(CurrentUserId, companyId);
            var result = await _service.GetPagedByCompanyAsync(companyId, clampedPage, size, search, supplierId, dateFrom, dateTo, divisionId, divScope);
            return Ok(result);
        }

        [HttpGet("{id}")]
        [HasPermission("purchasebills.list.view")]
        public async Task<ActionResult<PurchaseBillDto>> GetById(int id)
        {
            var pb = await _service.GetByIdAsync(id);
            if (pb == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, pb.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, pb.CompanyId, pb.DivisionId);
            return Ok(pb);
        }

        /// <summary>Flat merge-data payload for PurchaseBill print templates —
        /// same shape contract as the sales-side print endpoints.</summary>
        [HttpGet("{id}/print")]
        [HasPermission("purchasebills.print.view")]
        public async Task<ActionResult<PrintPurchaseBillDto>> GetPrintData(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var dto = await _service.GetPrintDataAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }

        [HttpPost]
        [HasPermission("purchasebills.manage.create")]
        public async Task<ActionResult<PurchaseBillDto>> Create([FromBody] CreatePurchaseBillDto dto)
        {
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            // Division-restricted users must tag the bill with one of their
            // divisions (write-assert also rejects null — policy D2).
            await _divisionAccess.AssertWriteAccessAsync(CurrentUserId, dto.CompanyId, dto.DivisionId);
            try
            {
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
        [HasPermission("purchasebills.manage.update")]
        public async Task<ActionResult<PurchaseBillDto>> Update(int id, [FromBody] UpdatePurchaseBillDto dto)
        {
            // Authorize on the existing row's company — body fields can't
            // smuggle the bill into another tenant.
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            // Division is immutable on update (UpdatePurchaseBillDto carries
            // none) — the read-assert on the stored tag is sufficient.
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                if (updated == null) return NotFound();
                return Ok(updated);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(new { error = ex.Message });
            }
        }

        /// <summary>Set/clear the bill's payment due date (drives the
        /// Overdue/Coming-due status). Gated by the payments permission — the
        /// due date is an AP concern, set by whoever manages disbursements.</summary>
        [HttpPut("{id}/due-date")]
        [HasPermission("accounting.payments.create")]
        public async Task<ActionResult<PurchaseBillDto>> SetDueDate(int id, [FromBody] SetDueDateRequest body)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var updated = await _service.SetDueDateAsync(id, body.DueDate);
            if (updated == null) return NotFound();
            return Ok(updated);
        }

        public class SetDueDateRequest
        {
            public DateTime? DueDate { get; set; }
        }

        [HttpDelete("{id}")]
        [HasPermission("purchasebills.manage.delete")]
        public async Task<IActionResult> Delete(int id)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            await _divisionAccess.AssertAccessAsync(CurrentUserId, existing.CompanyId, existing.DivisionId);
            var ok = await _service.DeleteAsync(id);
            if (!ok) return NotFound();
            return Ok(new { message = "Purchase bill deleted; stock movements reversed." });
        }
    }
}
