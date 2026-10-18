using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IPurchaseBillService
    {
        Task<PurchaseStockPreviewDto> PreviewStockAsync(PurchaseStockPreviewRequest request);
        Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null, bool? fromChallan = null, string? purchaseCategory = null, string? entrySource = null);
        Task<PurchaseBillDto?> GetByIdAsync(int id);
        /// <summary>Set/clear the bill's AP payment due date (drives the
        /// Overdue / Coming-due status). Returns the updated bill or null.</summary>
        Task<PurchaseBillDto?> SetDueDateAsync(int id, DateTime? dueDate);
        /// <summary>Flat merge-data payload for the PurchaseBill print templates.</summary>
        Task<PrintPurchaseBillDto?> GetPrintDataAsync(int id);
        Task<PurchaseBillDto> CreateAsync(CreatePurchaseBillDto dto);
        Task<List<LocalPurchaseChallanSummaryDto>> GetLocalPurchaseChallansAsync(int companyId);
        Task<LocalPurchaseChallanDto?> GetLocalPurchaseChallanAsync(int companyId, int challanId);
        Task<ChallanPurchasePreviewDto> PreviewFromChallanAsync(int challanId);
        Task<List<PurchaseBillDto>> CreateFromChallanAsync(int challanId, CreateChallanPurchasesDto? request = null);
        Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto);
        Task<bool> DeleteAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
