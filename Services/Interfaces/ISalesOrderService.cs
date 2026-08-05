using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface ISalesOrderService
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope from
        /// IDivisionAccessGuard: non-null = restricted user, return only rows in
        /// these divisions or with no division (policy D1). Null = unrestricted.</param>
        Task<List<SalesOrderDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        /// <summary>Open orders that still have undelivered quantity — powers the challan picker.</summary>
        Task<List<SalesOrderDto>> GetOpenByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PagedResult<SalesOrderDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
        Task<SalesOrderDto?> GetByIdAsync(int id);
        Task<SalesOrderDto> CreateAsync(int companyId, SalesOrderDto dto);
        Task<SalesOrderDto?> UpdateAsync(int id, SalesOrderDto dto);
        Task<bool> DeleteAsync(int id);
        /// <summary>Set the operator lifecycle status (Open / Closed / Cancelled).</summary>
        Task<bool> SetStatusAsync(int id, string status);
        /// <summary>
        /// Create a Delivery Challan that fulfils this order — pre-filling the
        /// remaining quantity per line and linking each challan line back to its
        /// Sales Order line. Returns the created challan.
        /// </summary>
        Task<DeliveryChallanDto> CreateChallanFromOrderAsync(int id, CreateChallanFromOrderDto dto);
        /// <summary>
        /// Prefill payload for the standalone bill form: order header + lines
        /// with unit prices resolved server-side (source quote first, then the
        /// item's last billed rate). Null when the order doesn't exist.
        /// </summary>
        Task<SalesOrderInvoicePrefillDto?> GetInvoicePrefillAsync(int id);
        Task<PrintOrderDto?> GetPrintDataAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        /// <summary>Delivery challans raised against this order, for the View / drill-down.</summary>
        Task<List<SalesOrderChallanDto>> GetChallansForOrderAsync(int orderId);
        /// <summary>
        /// Unlinked, unbilled, non-cancelled challans in this order's division —
        /// for the order's client — that carry no PO of their own. Candidates
        /// for attaching to the order (e.g. No-PO challans raised before the PO
        /// arrived). Empty when the order doesn't exist.
        /// </summary>
        Task<List<AttachableChallanDto>> GetAttachableChallansAsync(int orderId);
        /// <summary>
        /// Link an existing challan to this order: map its lines onto the ordered
        /// lines (roll-up), copy the order's PO onto the challan (flipping "No PO"
        /// → "Pending" when the order has a PO), and auto-close the order if it's
        /// now fully delivered. The challan must be in the SAME company AND
        /// division as the order. Records NO stock movement — the challan's stock
        /// was already booked at its creation. Returns the updated order, or null
        /// when the order doesn't exist.
        /// </summary>
        Task<SalesOrderDto?> AttachChallanAsync(int orderId, AttachChallanRequestDto dto);
    }
}
