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
        /// Narrow update path: re-derives FBR fields (HS / UOM / SaleType)
        /// from a new ItemType per line. Refuses to change price, description,
        /// header fields, etc.
        ///
        /// Permission flows (controller picks the flag based on which
        /// endpoint the request hit):
        ///   • allowQuantityEdit=false → invoices.manage.update.itemtype
        ///       (Item Type only — qty in payload is ignored)
        ///   • allowQuantityEdit=true  → invoices.manage.update.itemtype.qty
        ///       (Item Type + Quantity, with decimal validation)
        /// </summary>
        Task<InvoiceDto?> UpdateItemTypesAsync(int id, UpdateInvoiceItemTypesDto dto, bool allowQuantityEdit = false);
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
        /// <summary>
        /// Flat InvoiceItem search across a company's billing history. Powers
        /// the Item Rate History page — given an item (by catalog id or free
        /// text), return every bill line where it appeared, with bill number,
        /// date, client, qty, unit price, and total. The result also carries
        /// avg/min/max unit price across the full filtered set so the
        /// operator can see the rate band before quoting.
        /// </summary>
        Task<ItemRateHistoryResultDto> GetItemRateHistoryAsync(
            int companyId, int page, int pageSize,
            int? itemTypeId, string? search,
            int? clientId, DateTime? dateFrom, DateTime? dateTo);

        /// <summary>
        /// For each item in the given challan, look up the most-recent
        /// non-demo bill line that billed the same product and return its
        /// unit price + bill number + date. Powers the "auto-fill rates"
        /// behaviour on the Generate-Bill shortcut. Match precedence:
        ///   1. Same ItemTypeId (precise)
        ///   2. Same Description, case-insensitive (fallback)
        /// Items without a match are returned with null values so the UI
        /// can leave them blank for the operator to enter manually.
        /// </summary>
        Task<List<LastRateDto>> GetLastRatesForChallanAsync(int companyId, int challanId);
    }
}
