using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface ISalesQuoteService
    {
        Task<List<SalesQuoteDto>> GetByCompanyAsync(int companyId);
        Task<PagedResult<SalesQuoteDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null);
        Task<SalesQuoteDto?> GetByIdAsync(int id);
        Task<SalesQuoteDto> CreateAsync(int companyId, SalesQuoteDto dto);
        Task<SalesQuoteDto?> UpdateAsync(int id, SalesQuoteDto dto);
        Task<bool> DeleteAsync(int id);
        /// <summary>Set a lifecycle status (Draft / Sent / Accepted / Rejected / Expired).</summary>
        Task<bool> SetStatusAsync(int id, string status);
        /// <summary>
        /// Convert an accepted quote into a (quantity-only) Sales Order. Copies
        /// client + items, marks the quote "Converted", and returns the new order.
        /// </summary>
        Task<SalesOrderDto> ConvertToSalesOrderAsync(int id);
        Task<PrintQuoteDto?> GetPrintDataAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
        /// <summary>
        /// Most-recent billed unit price for an item (matched by ItemType, then
        /// Description) so the quote form can pre-fill the price for items that
        /// already exist in the system.
        /// </summary>
        Task<QuoteItemRateDto> GetItemRateAsync(int companyId, string? description, int? itemTypeId);
    }
}
