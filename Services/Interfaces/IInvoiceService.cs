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
        Task<InvoiceDto?> UpdateAsync(int id, UpdateInvoiceDto dto);
        /// <summary>
        /// Narrow update path: ONLY re-derives FBR fields (HS / UOM / SaleType)
        /// from a new ItemType per line. Refuses to change quantity, price,
        /// description, header fields, etc. Used when a user has the
        /// `invoices.manage.update.itemtype` permission but not full
        /// `invoices.manage.update`.
        /// </summary>
        Task<InvoiceDto?> UpdateItemTypesAsync(int id, UpdateInvoiceItemTypesDto dto);
        Task<bool> DeleteAsync(int id);
        /// <summary>
        /// Flip the IsFbrExcluded flag. Excluded bills are skipped by the
        /// bulk Validate All / Submit All endpoints; per-bill validate and
        /// submit still work. Returns the updated bill or null if not found.
        /// </summary>
        Task<InvoiceDto?> SetFbrExcludedAsync(int id, bool excluded);
        Task<PrintBillDto?> GetPrintBillAsync(int invoiceId);
        Task<PrintTaxInvoiceDto?> GetPrintTaxInvoiceAsync(int invoiceId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
