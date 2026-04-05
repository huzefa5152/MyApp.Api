using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IDeliveryChallanRepository
    {
        Task<List<DeliveryChallan>> GetDeliveryChallansByCompanyAsync(int companyId);
        Task<(List<DeliveryChallan> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<DeliveryChallan?> GetByIdAsync(int id);
        Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan);
        Task<DeliveryChallan> UpdateAsync(DeliveryChallan deliveryChallan);
        Task DeleteAsync(DeliveryChallan deliveryChallan);
        Task DeleteItemAsync(DeliveryItem item);
        Task<DeliveryItem?> GetItemByIdAsync(int itemId);
        Task<List<DeliveryChallan>> GetPendingChallansByCompanyAsync(int companyId);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<bool> HasChallansForCompanyAsync(int companyId);
    }
}
