using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IDeliveryChallanRepository
    {
        Task<List<DeliveryChallan>> GetDeliveryChallansByCompanyAsync(int companyId);
        Task<DeliveryChallan> CreateDeliveryChallanAsync(DeliveryChallan deliveryChallan);
        Task<int> GetTotalCountAsync();
    }
}
