using MyApp.Api.DTOs;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    public class ClientService : IClientService
    {
        private readonly IClientRepository _repo;
        public ClientService(IClientRepository repo) => _repo = repo;

        private static ClientDto ToDto(Client c) => new()
        {
            Id = c.Id,
            Name = c.Name,
            Address = c.Address,
            Phone = c.Phone,
            Email = c.Email,
            CompanyId = c.CompanyId,
            CreatedAt = c.CreatedAt
        };

        public async Task<IEnumerable<ClientDto>> GetAllAsync()
        {
            var clients = await _repo.GetAllAsync();
            return clients.Select(ToDto);
        }

        public async Task<IEnumerable<ClientDto>> GetByCompanyAsync(int companyId)
        {
            var clients = await _repo.GetByCompanyAsync(companyId);
            return clients.Select(ToDto);
        }

        public async Task<ClientDto?> GetByIdAsync(int id)
        {
            var c = await _repo.GetByIdAsync(id);
            return c == null ? null : ToDto(c);
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

            await _repo.UpdateAsync(client);
            return ToDto(client);
        }

        public async Task DeleteAsync(int id)
        {
            var client = await _repo.GetByIdAsync(id);
            if (client == null) return;
            await _repo.DeleteAsync(client);
        }
    }
}
