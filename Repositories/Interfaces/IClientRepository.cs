using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IClientRepository
    {
        Task<IEnumerable<Client>> GetAllAsync();
        Task<IEnumerable<Client>> GetByCompanyAsync(int companyId);
        Task<Client?> GetByIdAsync(int id);
        Task<Client> CreateAsync(Client client);
        Task<Client?> UpdateAsync(Client client);
        Task DeleteAsync(Client client);
        Task<bool> ExistsWithNameAsync(string name, int companyId, int? excludeId = null);
    }
}
