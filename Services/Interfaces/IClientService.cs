using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IClientService
    {
        Task<IEnumerable<ClientDto>> GetAllAsync();
        Task<IEnumerable<ClientDto>> GetByCompanyAsync(int companyId);
        Task<ClientDto?> GetByIdAsync(int id);
        Task<ClientDto> CreateAsync(ClientDto dto);
        Task<ClientDto> UpdateAsync(ClientDto dto);
        Task DeleteAsync(int id);
    }
}
