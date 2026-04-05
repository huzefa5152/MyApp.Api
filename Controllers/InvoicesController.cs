using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyApp.Api.DTOs;
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
        public async Task<ActionResult<int>> GetTotalCount([FromQuery] int? companyId)
        {
            if (companyId.HasValue)
                return Ok(await _service.GetCountByCompanyAsync(companyId.Value));
            return Ok(await _service.GetTotalCountAsync());
        }

        [HttpGet("company/{companyId}")]
        public async Task<ActionResult<List<InvoiceDto>>> GetByCompany(int companyId)
        {
            var invoices = await _service.GetByCompanyAsync(companyId);
            return Ok(invoices);
        }

        [HttpGet("company/{companyId}/paged")]
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
        public async Task<ActionResult<InvoiceDto>> GetById(int id)
        {
            var invoice = await _service.GetByIdAsync(id);
            if (invoice == null) return NotFound();
            return Ok(invoice);
        }

        [HttpPost]
        public async Task<ActionResult<InvoiceDto>> Create([FromBody] CreateInvoiceDto dto)
        {
            try
            {
                if (dto.ChallanIds == null || !dto.ChallanIds.Any())
                    return BadRequest(new { error = "At least one challan must be selected." });
                if (dto.Items == null || !dto.Items.Any())
                    return BadRequest(new { error = "At least one item with unit price is required." });

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

        [HttpGet("{id}/print/bill")]
        public async Task<ActionResult<PrintBillDto>> GetPrintBill(int id)
        {
            var dto = await _service.GetPrintBillAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }

        [HttpGet("{id}/print/tax-invoice")]
        public async Task<ActionResult<PrintTaxInvoiceDto>> GetPrintTaxInvoice(int id)
        {
            var dto = await _service.GetPrintTaxInvoiceAsync(id);
            if (dto == null) return NotFound();
            return Ok(dto);
        }
    }
}
