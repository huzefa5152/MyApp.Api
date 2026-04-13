using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IInvoiceRepository
    {
        Task<List<Invoice>> GetByCompanyAsync(int companyId);
        Task<(List<Invoice> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<Invoice?> GetByIdAsync(int id);
        Task<Invoice> CreateAsync(Invoice invoice);
        Task UpdateAsync(Invoice invoice);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<bool> HasInvoicesForClientAsync(int clientId);
        Task<bool> HasInvoicesForCompanyAsync(int companyId);
        Task<Dictionary<int, bool>> HasInvoicesForClientsAsync(IEnumerable<int> clientIds);
    }
}
