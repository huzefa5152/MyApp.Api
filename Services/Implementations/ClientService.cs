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

        public async Task<IEnumerable<ClientDto>> GetAllAsync()
        {
            var clients = await _repo.GetAllAsync();
            return clients.Select(c => new ClientDto
            {
                Id = c.Id,
                Name = c.Name,
                Address = c.Address,
                Phone = c.Phone,
                Email = c.Email,
                CreatedAt = c.CreatedAt
            });
        }

        public async Task<ClientDto?> GetByIdAsync(int id)
        {
            var c = await _repo.GetByIdAsync(id);
            if (c == null) return null;
            return new ClientDto
            {
                Id = c.Id,
                Name = c.Name,
                Address = c.Address,
                Phone = c.Phone,
                Email = c.Email,
                CreatedAt = c.CreatedAt
            };
        }

        public async Task<ClientDto> CreateAsync(ClientDto dto)
        {
            if (await _repo.ExistsWithNameAsync(dto.Name))
                throw new InvalidOperationException("Client with this name already exists.");

            var client = new Client
            {
                Name = dto.Name,
                Address = dto.Address,
                Phone = dto.Phone,
                Email = dto.Email,
                CreatedAt = DateTime.UtcNow
            };

            var created = await _repo.CreateAsync(client);
            return new ClientDto
            {
                Id = created.Id,
                Name = created.Name,
                Address = created.Address,
                Phone = created.Phone,
                Email = created.Email,
                CreatedAt = created.CreatedAt
            };
        }

        public async Task<ClientDto> UpdateAsync(ClientDto dto)
        {
            if (dto.Id == null) throw new ArgumentException("Client ID is required for update.");

            var client = await _repo.GetByIdAsync(dto.Id.Value);
            if (client == null) throw new KeyNotFoundException("Client not found.");

            if (await _repo.ExistsWithNameAsync(dto.Name, dto.Id))
                throw new InvalidOperationException("Client with this name already exists.");

            client.Name = dto.Name;
            client.Address = dto.Address;
            client.Phone = dto.Phone;
            client.Email = dto.Email;

            await _repo.UpdateAsync(client);

            return new ClientDto
            {
                Id = client.Id,
                Name = client.Name,
                Address = client.Address,
                Phone = client.Phone,
                Email = client.Email,
                CreatedAt = client.CreatedAt
            };
        }

        public async Task DeleteAsync(int id)
        {
            var client = await _repo.GetByIdAsync(id);
            if (client == null) return;
            await _repo.DeleteAsync(client);
        }
    }
}
