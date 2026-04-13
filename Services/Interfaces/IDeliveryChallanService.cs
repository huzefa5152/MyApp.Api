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
        Task<bool> CancelAsync(int challanId);
        Task<bool> DeleteAsync(int challanId);
        Task<bool> DeleteItemAsync(int itemId);
        Task<List<DeliveryChallanDto>> GetPendingChallansByCompanyAsync(int companyId);
        Task<PrintChallanDto?> GetPrintDataAsync(int challanId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
    }
}
