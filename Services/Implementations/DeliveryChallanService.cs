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

        private static DeliveryChallanDto ToDto(DeliveryChallan dc)
        {
            var dto = new DeliveryChallanDto
            {
                Id = dc.Id,
                ChallanNumber = dc.ChallanNumber,
                ClientId = dc.ClientId,
                ClientName = dc.Client?.Name ?? "",
                PoNumber = dc.PoNumber,
                PoDate = dc.PoDate,
                DeliveryDate = dc.DeliveryDate,
                Site = dc.Site,
                Status = dc.Status,
                InvoiceId = dc.InvoiceId,
                Items = dc.Items.Select(i => new DeliveryItemDto
                {
                    Id = i.Id,
                    ItemTypeId = i.ItemTypeId,
                    ItemTypeName = i.ItemType?.Name ?? "",
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            // Compute warnings for missing tax info
            var company = dc.Company;
            var client = dc.Client;
            if (company != null && string.IsNullOrWhiteSpace(company.NTN))
                dto.Warnings.Add("Company NTN missing");
            if (company != null && string.IsNullOrWhiteSpace(company.STRN))
                dto.Warnings.Add("Company STRN missing");
            if (client != null && string.IsNullOrWhiteSpace(client.NTN))
                dto.Warnings.Add("Client NTN missing");
            if (client != null && string.IsNullOrWhiteSpace(client.STRN))
                dto.Warnings.Add("Client STRN missing");

            return dto;
        }

        /// <summary>Returns true if the challan is in an editable state.</summary>
        private static bool IsEditable(DeliveryChallan dc) =>
            dc.Status == "Pending" || dc.Status == "No PO";

        public async Task<List<DeliveryChallanDto>> GetDeliveryChallansByCompanyAsync(int companyId)
        {
            var challans = await _repository.GetDeliveryChallansByCompanyAsync(companyId);
            return challans.Select(ToDto).ToList();
        }

        public async Task<PagedResult<DeliveryChallanDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null)
        {
            var (items, totalCount) = await _repository.GetPagedByCompanyAsync(
                companyId, page, pageSize, search, status, clientId, dateFrom, dateTo);
            return new PagedResult<DeliveryChallanDto>
            {
                Items = items.Select(ToDto).ToList(),
                TotalCount = totalCount,
                Page = page,
                PageSize = pageSize
            };
        }

        public async Task<DeliveryChallanDto?> GetByIdAsync(int id)
        {
            var dc = await _repository.GetByIdAsync(id);
            return dc == null ? null : ToDto(dc);
        }

        public async Task<DeliveryChallanDto> CreateDeliveryChallanAsync(int companyId, DeliveryChallanDto dto)
        {
            var hasPo = !string.IsNullOrWhiteSpace(dto.PoNumber);
            var deliveryChallan = new DeliveryChallan
            {
                CompanyId = companyId,
                ClientId = dto.ClientId,
                Site = dto.Site,
                PoNumber = dto.PoNumber?.Trim() ?? "",
                PoDate = hasPo ? dto.PoDate : null,
                DeliveryDate = dto.DeliveryDate,
                Status = hasPo ? "Pending" : "No PO",
                Items = dto.Items.Select(i => new DeliveryItem
                {
                    ItemTypeId = i.ItemTypeId,
                    Description = i.Description,
                    Quantity = i.Quantity,
                    Unit = i.Unit
                }).ToList()
            };

            var created = await _repository.CreateDeliveryChallanAsync(deliveryChallan);
            return ToDto(created);
        }

        public async Task<DeliveryChallanDto?> UpdateItemsAsync(int challanId, List<DeliveryItemDto> items)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;
            if (!IsEditable(dc))
                throw new InvalidOperationException("Can only edit items on Pending or No PO challans.");

            // Remove items not in the updated list
            var updatedIds = items.Where(i => i.Id > 0).Select(i => i.Id).ToHashSet();
            var toRemove = dc.Items.Where(i => !updatedIds.Contains(i.Id)).ToList();
            foreach (var item in toRemove)
                await _repository.DeleteItemAsync(item);

            // Update existing and add new
            foreach (var itemDto in items)
            {
                var existing = dc.Items.FirstOrDefault(i => i.Id == itemDto.Id && itemDto.Id > 0);
                if (existing != null)
                {
                    existing.ItemTypeId = itemDto.ItemTypeId;
                    existing.Description = itemDto.Description;
                    existing.Quantity = itemDto.Quantity;
                    existing.Unit = itemDto.Unit;
                }
                else
                {
                    dc.Items.Add(new DeliveryItem
                    {
                        DeliveryChallanId = challanId,
                        ItemTypeId = itemDto.ItemTypeId,
                        Description = itemDto.Description,
                        Quantity = itemDto.Quantity,
                        Unit = itemDto.Unit
                    });
                }
            }

            var updated = await _repository.UpdateAsync(dc);
            // Reload to get fresh data
            var reloaded = await _repository.GetByIdAsync(challanId);
            return reloaded == null ? null : ToDto(reloaded);
        }

        public async Task<bool> CancelAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return false;
            if (!IsEditable(dc))
                throw new InvalidOperationException("Can only cancel Pending or No PO challans.");

            dc.Status = "Cancelled";
            await _repository.UpdateAsync(dc);
            return true;
        }

        public async Task<bool> DeleteAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return false;
            if (!IsEditable(dc))
                throw new InvalidOperationException("Can only delete Pending or No PO challans.");

            await _repository.DeleteAsync(dc);
            return true;
        }

        public async Task<bool> DeleteItemAsync(int itemId)
        {
            var item = await _repository.GetItemByIdAsync(itemId);
            if (item == null) return false;
            if (!IsEditable(item.DeliveryChallan))
                throw new InvalidOperationException("Can only delete items from Pending or No PO challans.");

            await _repository.DeleteItemAsync(item);
            return true;
        }

        public async Task<DeliveryChallanDto?> UpdatePoAsync(int challanId, string poNumber, DateTime? poDate)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;
            if (dc.Status != "No PO")
                throw new InvalidOperationException("Can only add PO details to 'No PO' challans.");

            dc.PoNumber = poNumber.Trim();
            dc.PoDate = poDate;
            dc.Status = "Pending";
            await _repository.UpdateAsync(dc);
            var reloaded = await _repository.GetByIdAsync(challanId);
            return reloaded == null ? null : ToDto(reloaded);
        }

        public async Task<List<DeliveryChallanDto>> GetPendingChallansByCompanyAsync(int companyId)
        {
            var challans = await _repository.GetPendingChallansByCompanyAsync(companyId);
            return challans.Select(ToDto).ToList();
        }

        public async Task<PrintChallanDto?> GetPrintDataAsync(int challanId)
        {
            var dc = await _repository.GetByIdAsync(challanId);
            if (dc == null) return null;

            return new PrintChallanDto
            {
                CompanyBrandName = dc.Company?.BrandName ?? dc.Company?.Name ?? "",
                CompanyLogoPath = dc.Company?.LogoPath,
                CompanyAddress = dc.Company?.FullAddress,
                CompanyPhone = dc.Company?.Phone,
                ChallanNumber = dc.ChallanNumber,
                DeliveryDate = dc.DeliveryDate,
                ClientName = dc.Client?.Name ?? "",
                ClientAddress = dc.Client?.Address,
                ClientSite = dc.Site,
                PoNumber = dc.PoNumber,
                PoDate = dc.PoDate,
                Items = dc.Items.Select(i => new PrintChallanItemDto
                {
                    Quantity = i.Quantity,
                    Description = i.Description,
                    Unit = i.Unit
                }).ToList()
            };
        }

        public async Task<int> GetTotalCountAsync()
        {
            return await _repository.GetTotalCountAsync();
        }

        public async Task<int> GetCountByCompanyAsync(int companyId)
        {
            return await _repository.GetCountByCompanyAsync(companyId);
        }
    }
}
