using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;
using MyApp.Api.Repositories.Interfaces;

namespace MyApp.Api.Repositories.Implementations
{
    public class ClientRepository : IClientRepository
    {
        private readonly AppDbContext _db;
        public ClientRepository(AppDbContext db) => _db = db;

        public async Task<IEnumerable<Client>> GetAllAsync() =>
            await _db.Clients.AsNoTracking().ToListAsync();

        public async Task<IEnumerable<Client>> GetByCompanyAsync(int companyId) =>
            await _db.Clients.AsNoTracking()
                .Where(c => c.CompanyId == companyId)
                .OrderBy(c => c.Name)
                .ToListAsync();

        public async Task<Client?> GetByIdAsync(int id) =>
            await _db.Clients.FindAsync(id);

        public async Task<Client> CreateAsync(Client client)
        {
            _db.Clients.Add(client);
            await _db.SaveChangesAsync();
            return client;
        }

        public async Task<Client?> UpdateAsync(Client client)
        {
            _db.Clients.Update(client);
            await _db.SaveChangesAsync();
            return client;
        }

        public async Task DeleteAsync(Client client)
        {
            _db.Clients.Remove(client);
            await _db.SaveChangesAsync();
        }

        public async Task<bool> ExistsWithNameAsync(string name, int companyId, int? excludeId = null)
        {
            return await _db.Clients.AnyAsync(c =>
                c.Name.ToLower() == name.ToLower() &&
                c.CompanyId == companyId &&
                (excludeId == null || c.Id != excludeId));
        }
    }
}
