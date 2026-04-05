using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IInvoiceService
    {
        Task<List<InvoiceDto>> GetByCompanyAsync(int companyId);
        Task<PagedResult<InvoiceDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<InvoiceDto?> GetByIdAsync(int id);
        Task<InvoiceDto> CreateAsync(CreateInvoiceDto dto);
        Task<PrintBillDto?> GetPrintBillAsync(int invoiceId);
        Task<PrintTaxInvoiceDto?> GetPrintTaxInvoiceAsync(int invoiceId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
