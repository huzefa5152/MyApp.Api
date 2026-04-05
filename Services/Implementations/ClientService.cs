using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ClientService : IClientService
    {
        private readonly IClientRepository _repo;
        private readonly IInvoiceRepository _invoiceRepo;
        public ClientService(IClientRepository repo, IInvoiceRepository invoiceRepo)
        {
            _repo = repo;
            _invoiceRepo = invoiceRepo;
        }

        private static ClientDto ToDto(Client c, bool hasInvoices = false) => new()
        {
            Id = c.Id,
            Name = c.Name,
            Address = c.Address,
            Phone = c.Phone,
            Email = c.Email,
            NTN = c.NTN,
            STRN = c.STRN,
            CompanyId = c.CompanyId,
            HasInvoices = hasInvoices,
            CreatedAt = c.CreatedAt
        };

        public async Task<IEnumerable<ClientDto>> GetAllAsync()
        {
            var clients = (await _repo.GetAllAsync()).ToList();
            var clientIds = clients.Select(c => c.Id).ToList();
            var hasInvoicesMap = await _invoiceRepo.HasInvoicesForClientsAsync(clientIds);
            return clients.Select(c => ToDto(c, hasInvoicesMap.GetValueOrDefault(c.Id)));
        }

        public async Task<IEnumerable<ClientDto>> GetByCompanyAsync(int companyId)
        {
            var clients = (await _repo.GetByCompanyAsync(companyId)).ToList();
            var clientIds = clients.Select(c => c.Id).ToList();
            var hasInvoicesMap = await _invoiceRepo.HasInvoicesForClientsAsync(clientIds);
            return clients.Select(c => ToDto(c, hasInvoicesMap.GetValueOrDefault(c.Id)));
        }

        public async Task<ClientDto?> GetByIdAsync(int id)
        {
            var c = await _repo.GetByIdAsync(id);
            if (c == null) return null;
            var hasInvoices = await _invoiceRepo.HasInvoicesForClientAsync(c.Id);
            return ToDto(c, hasInvoices);
        }

        public async Task<ClientDto> CreateAsync(ClientDto dto)
        {
            if (await _repo.ExistsWithNameAsync(dto.Name, dto.CompanyId))
                throw new InvalidOperationException("Client with this name already exists for this company.");

            var client = new Client
            {
                Name = dto.Name,
                Address = dto.Address,
                Phone = dto.Phone,
                Email = dto.Email,
                NTN = dto.NTN,
                STRN = dto.STRN,
                CompanyId = dto.CompanyId,
                CreatedAt = DateTime.UtcNow
            };

            var created = await _repo.CreateAsync(client);
            return ToDto(created);
        }

        public async Task<ClientDto> UpdateAsync(ClientDto dto)
        {
            if (dto.Id == null) throw new ArgumentException("Client ID is required for update.");

            var client = await _repo.GetByIdAsync(dto.Id.Value);
            if (client == null) throw new KeyNotFoundException("Client not found.");

            if (await _repo.ExistsWithNameAsync(dto.Name, client.CompanyId, dto.Id))
                throw new InvalidOperationException("Client with this name already exists for this company.");

            client.Name = dto.Name;
            client.Address = dto.Address;
            client.Phone = dto.Phone;
            client.Email = dto.Email;
            client.NTN = dto.NTN;
            client.STRN = dto.STRN;

            var hasInvoices = await _invoiceRepo.HasInvoicesForClientAsync(client.Id);
            await _repo.UpdateAsync(client);
            return ToDto(client, hasInvoices);
        }

        public async Task DeleteAsync(int id)
        {
            var client = await _repo.GetByIdAsync(id);
            if (client == null) return;
            await _repo.DeleteAsync(client);
        }
    }
}
