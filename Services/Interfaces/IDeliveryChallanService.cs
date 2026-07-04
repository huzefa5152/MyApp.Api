using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IDeliveryChallanService
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope from
        /// IDivisionAccessGuard: non-null = restricted user, return only rows in
        /// these divisions or with no division (policy D1). Null = unrestricted.</param>
        Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PagedResult<DeliveryChallanDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
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

        /// <summary>
        /// Returns the parent challan's (CompanyId, DivisionId) for a given
        /// item, or null when the item doesn't exist. Used by the controller
        /// to gate per-item endpoints with ICompanyAccessGuard (audit H-2,
        /// 2026-05-13) and IDivisionAccessGuard.
        /// </summary>
        Task<(int CompanyId, int? DivisionId)?> GetCompanyForItemAsync(int itemId);
        Task<List<DeliveryChallanDto>> GetPendingChallansByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PrintChallanDto?> GetPrintDataAsync(int challanId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<int> ReEvaluateSetupRequiredAsync(int companyId, int? clientId = null);

        /// <summary>
        /// Insert a historical challan with an explicit challan number (from an
        /// imported old Excel file). Does NOT bump the company's live challan
        /// counter — imports back-fill history only. Fails if the number is
        /// already taken on this company. Marks the row as IsImported.
        /// divisionId (write-asserted by the controller) is validated against
        /// the company and stamped on the challan; null = company-level.
        /// </summary>
        Task<ChallanImportResultDto> ImportHistoricalAsync(int companyId, ChallanImportPreviewDto dto, int? divisionId = null);

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

        /// <summary>
        /// Bulk version — creates <paramref name="count"/> duplicates of the
        /// same source in one go. Same eligibility rules as the single
        /// duplicate (Pending/Imported, non-Demo, non-already-a-duplicate).
        /// Caps internally at 20 to prevent runaway entries. See
        /// 2026-05-08 ChallanPage UX upgrade.
        /// </summary>
        Task<List<DeliveryChallanDto>> DuplicateAsync(int sourceId, int count);
    }
}
