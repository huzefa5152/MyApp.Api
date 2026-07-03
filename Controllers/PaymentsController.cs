using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
using MyApp.Api.Helpers;
using MyApp.Api.Middleware;
using MyApp.Api.Models.Accounting;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Controllers
{
    /// <summary>
    /// Receipts (money in) and Payments (money out) — the AR/AP payment
    /// subledger (design §11.5, Phase A). Receipts and payments are deliberately
    /// split into separate routes + permissions (separation of duties: a cashier
    /// may record receipts without being able to pay money out). Direction is
    /// fixed by the route, never trusted from the body.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/payments")]
    public class PaymentsController : ControllerBase
    {
        private readonly IPaymentService _service;
        private readonly ICompanyAccessGuard _access;
        private readonly ILogger<PaymentsController> _logger;
        private readonly int _defaultPageSize;

        public PaymentsController(
            IPaymentService service, ICompanyAccessGuard access,
            ILogger<PaymentsController> logger, IConfiguration configuration)
        {
            _service = service;
            _access = access;
            _logger = logger;
            _defaultPageSize = configuration.GetValue<int>("Pagination:DefaultPageSize", 10);
        }

        private int CurrentUserId =>
            int.TryParse(
                User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? User.FindFirstValue(ClaimTypes.NameIdentifier),
                out var id) ? id : 0;

        // ── Receipts (money in — settle sales invoices) ───────────────────────

        [HttpGet("receipts/company/{companyId}/paged")]
        [HasPermission("accounting.receipts.view")]
        [AuthorizeCompany]
        public Task<ActionResult<PagedResult<PaymentDto>>> GetReceipts(
            int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null, [FromQuery] int? contactId = null,
            [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null)
            => GetPaged(companyId, PaymentDirection.Receipt, page, pageSize, search, contactId, dateFrom, dateTo);

        [HttpGet("receipts/{id}")]
        [HasPermission("accounting.receipts.view")]
        public Task<IActionResult> GetReceipt(int id) => GetOne(id, PaymentDirection.Receipt);

        [HttpGet("company/{companyId}/by-invoice/{invoiceId}")]
        [HasPermission("accounting.receipts.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<PaymentDto>>> GetByInvoice(int companyId, int invoiceId)
            => Ok(await _service.GetByInvoiceAsync(companyId, invoiceId));

        [HttpPost("receipts/company/{companyId}")]
        [HasPermission("accounting.receipts.create")]
        [AuthorizeCompany]
        public Task<IActionResult> CreateReceipt(int companyId, [FromBody] CreatePaymentDto dto)
            => Create(companyId, dto, PaymentDirection.Receipt);

        [HttpPut("receipts/{id}")]
        [HasPermission("accounting.receipts.create")]
        public Task<IActionResult> UpdateReceipt(int id, [FromBody] CreatePaymentDto dto)
            => Update(id, dto, PaymentDirection.Receipt);

        [HttpDelete("receipts/{id}")]
        [HasPermission("accounting.receipts.delete")]
        public Task<IActionResult> DeleteReceipt(int id) => Delete(id, PaymentDirection.Receipt);

        // ── Payments (money out — settle purchase bills) ──────────────────────

        [HttpGet("payments/company/{companyId}/paged")]
        [HasPermission("accounting.payments.view")]
        [AuthorizeCompany]
        public Task<ActionResult<PagedResult<PaymentDto>>> GetPayments(
            int companyId, [FromQuery] int page = 1, [FromQuery] int? pageSize = null,
            [FromQuery] string? search = null, [FromQuery] int? contactId = null,
            [FromQuery] DateTime? dateFrom = null, [FromQuery] DateTime? dateTo = null)
            => GetPaged(companyId, PaymentDirection.Payment, page, pageSize, search, contactId, dateFrom, dateTo);

        [HttpGet("payments/{id}")]
        [HasPermission("accounting.payments.view")]
        public Task<IActionResult> GetPayment(int id) => GetOne(id, PaymentDirection.Payment);

        [HttpGet("company/{companyId}/by-bill/{billId}")]
        [HasPermission("accounting.payments.view")]
        [AuthorizeCompany]
        public async Task<ActionResult<List<PaymentDto>>> GetByBill(int companyId, int billId)
            => Ok(await _service.GetByPurchaseBillAsync(companyId, billId));

        [HttpPost("payments/company/{companyId}")]
        [HasPermission("accounting.payments.create")]
        [AuthorizeCompany]
        public Task<IActionResult> CreatePayment(int companyId, [FromBody] CreatePaymentDto dto)
            => Create(companyId, dto, PaymentDirection.Payment);

        [HttpPut("payments/{id}")]
        [HasPermission("accounting.payments.create")]
        public Task<IActionResult> UpdatePayment(int id, [FromBody] CreatePaymentDto dto)
            => Update(id, dto, PaymentDirection.Payment);

        [HttpDelete("payments/{id}")]
        [HasPermission("accounting.payments.delete")]
        public Task<IActionResult> DeletePayment(int id) => Delete(id, PaymentDirection.Payment);

        /// <summary>Cheque/PDC lifecycle: advance ChequeStatus (Pending →
        /// Deposited → Cleared / Bounced) without a full document edit.
        /// Direction-agnostic; anyone who can record either direction can
        /// maintain the cheque register.</summary>
        [HttpPatch("{id}/cheque-status")]
        [HasAnyPermission("accounting.receipts.create", "accounting.payments.create")]
        public async Task<IActionResult> SetChequeStatus(int id, [FromBody] UpdateChequeStatusDto dto)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            try
            {
                var updated = await _service.SetChequeStatusAsync(id, dto.Status);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
        }

        // ── Shared implementations ────────────────────────────────────────────

        private async Task<ActionResult<PagedResult<PaymentDto>>> GetPaged(
            int companyId, PaymentDirection direction, int page, int? pageSize,
            string? search, int? contactId, DateTime? dateFrom, DateTime? dateTo)
        {
            var size = PaginationHelper.Clamp(pageSize, _defaultPageSize);
            var clampedPage = PaginationHelper.ClampPage(page);
            var result = await _service.GetPagedByCompanyAsync(
                companyId, direction, clampedPage, size, search, contactId, dateFrom, dateTo);
            return Ok(result);
        }

        private async Task<IActionResult> GetOne(int id, PaymentDirection direction)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null || dto.Direction != direction.ToString()) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            return Ok(dto);
        }

        private async Task<IActionResult> Create(int companyId, CreatePaymentDto dto, PaymentDirection direction)
        {
            dto.Direction = direction.ToString(); // route wins — never trust the body
            try
            {
                var created = await _service.CreateAsync(companyId, dto);
                return CreatedAtAction(
                    direction == PaymentDirection.Receipt ? nameof(GetReceipt) : nameof(GetPayment),
                    new { id = created.Id }, created);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Create {Direction} failed for company {CompanyId}", direction, companyId);
                return StatusCode(500, new { error = "Could not save the document. Please try again." });
            }
        }

        private async Task<IActionResult> Update(int id, CreatePaymentDto dto, PaymentDirection direction)
        {
            var existing = await _service.GetByIdAsync(id);
            if (existing == null || existing.Direction != direction.ToString()) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, existing.CompanyId);
            dto.Direction = direction.ToString(); // route wins — never trust the body
            try
            {
                var updated = await _service.UpdateAsync(id, dto);
                return updated == null ? NotFound() : Ok(updated);
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Update {Direction} {Id} failed", direction, id);
                return StatusCode(500, new { error = "Could not save the document. Please try again." });
            }
        }

        private async Task<IActionResult> Delete(int id, PaymentDirection direction)
        {
            var dto = await _service.GetByIdAsync(id);
            if (dto == null || dto.Direction != direction.ToString()) return NotFound();
            await _access.AssertAccessAsync(CurrentUserId, dto.CompanyId);
            try
            {
                var ok = await _service.DeleteAsync(id);
                return ok ? NoContent() : NotFound();
            }
            catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Delete payment {Id} failed", id);
                return StatusCode(500, new { error = "Could not delete the document. Please try again." });
            }
        }
    }
}
