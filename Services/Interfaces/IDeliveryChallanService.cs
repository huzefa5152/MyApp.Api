using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IDeliveryChallanService
    {
        Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId);
        Task<DeliveryChallanDto> CreateDeliveryChallanAsync(int companyId, DeliveryChallanDto dto);
    }
}
