using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IDeliveryChallanService
    {
        Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId);
        Task<PagedResult<DeliveryChallanDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<DeliveryChallanDto?> GetByIdAsync(int id);
        Task<DeliveryChallanDto> CreateDeliveryChallanAsync(int companyId, DeliveryChallanDto dto);
        Task<DeliveryChallanDto?> UpdateItemsAsync(int challanId, List<DeliveryItemDto> items);
        Task<DeliveryChallanDto?> UpdatePoAsync(int challanId, string poNumber, DateTime? poDate);
        /// <summary>
        /// Full-field update for a challan. Lets the operator edit client, site,
        /// delivery date, PO number, PO date, and items in one round-trip.
        /// A null/empty PO number transitions Pending → No PO (and vice versa).
        /// Status re-evaluates based on FBR readiness of the (possibly new) client.
        /// Refuses if the challan is Cancelled or Invoiced-with-submitted-bill.
        /// </summary>
        Task<DeliveryChallanDto?> UpdateChallanAsync(int challanId, DeliveryChallanDto dto);
        Task<bool> CancelAsync(int challanId);
        Task<bool> DeleteAsync(int challanId);
        Task<bool> DeleteItemAsync(int itemId);
        Task<List<DeliveryChallanDto>> GetPendingChallansByCompanyAsync(int companyId);
        Task<PrintChallanDto?> GetPrintDataAsync(int challanId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<int> ReEvaluateSetupRequiredAsync(int companyId, int? clientId = null);

        /// <summary>
        /// Insert a historical challan with an explicit challan number (from an
        /// imported old Excel file). Does NOT bump the company's live challan
        /// counter — imports back-fill history only. Fails if the number is
        /// already taken on this company. Marks the row as IsImported.
        /// </summary>
        Task<ChallanImportResultDto> ImportHistoricalAsync(int companyId, ChallanImportPreviewDto dto);

        /// <summary>
        /// Clone an existing challan as a new, independently-billable row that
        /// reuses the same ChallanNumber. Used when one delivery covers multiple
        /// POs — each PO needs its own bill but the challan number must stay
        /// consistent with the physical delivery document. Source must be in
        /// "Pending" or "Imported" status. The clone inherits the source's
        /// Status and IsImported flag so historical (Imported) and native
        /// (Pending) populations stay correctly tagged for reporting; PO and
        /// items are copied as-is so the operator can edit them in the next
        /// step.
        /// </summary>
        Task<DeliveryChallanDto?> DuplicateAsync(int sourceId);
    }
}
