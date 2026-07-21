using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IPurchaseBillService
    {
        Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<PurchaseBillDto?> GetByIdAsync(int id);
        /// <summary>Flat merge-data payload for the PurchaseBill print templates.</summary>
        Task<PrintPurchaseBillDto?> GetPrintDataAsync(int id);
        Task<PurchaseBillDto> CreateAsync(CreatePurchaseBillDto dto);
        Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto);
        Task<bool> DeleteAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
