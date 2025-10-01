using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class DeliveryChallanService : IDeliveryChallanService
    {
        private readonly IDeliveryChallanRepository _repository;

        public DeliveryChallanService(IDeliveryChallanRepository repository)
        {
            _repository = repository;
        }

        public async Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId)
        {
            var deliveryChallans = await _repository.GetDeliveryChallansByCompanyAsync(companyId);

            return deliveryChallans.Select(dc => new DeliveryChallanDto
            {
                ChallanNumber = dc.ChallanNumber,
                ClientId = dc.ClientId,
                PoNumber = dc.PoNumber,
                DeliveryDate = dc.DeliveryDate,
                Items = dc.Items.Select(i => new DeliveryItemDto
                {
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            }).ToList();
        }

        public async Task<DeliveryChallanDto> CreateDeliveryChallanAsync(int companyId, DeliveryChallanDto dto)
        {
            var deliveryChallan = new DeliveryChallan
            {
                CompanyId = companyId,
                ClientId = dto.ClientId,
                PoNumber = dto.PoNumber,
                DeliveryDate = dto.DeliveryDate,
                Items = dto.Items.Select(i => new DeliveryItem
                {
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            var created = await _repository.CreateDeliveryChallanAsync(deliveryChallan);

            return new DeliveryChallanDto
            {
                ChallanNumber = created.ChallanNumber,
                ClientId = created.ClientId,
                PoNumber = created.PoNumber,
                DeliveryDate = created.DeliveryDate,
                Items = created.Items.Select(i => new DeliveryItemDto
                {
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };
        }
    }
}
