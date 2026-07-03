using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IInvoiceRepository
    {
        Task<List<Invoice>> GetByCompanyAsync(int companyId);
        /// <summary>noteType: null = sale bills only; 9 = Debit Notes; 10 = Credit Notes.</summary>
        Task<(List<Invoice> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? clientId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? noteType = null);
        Task<Invoice?> GetByIdAsync(int id);
        Task<Invoice> CreateAsync(Invoice invoice);
        Task UpdateAsync(Invoice invoice);
        Task<int> GetTotalCountAsync();
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<bool> HasInvoicesForClientAsync(int clientId);
        Task<bool> HasInvoicesForCompanyAsync(int companyId);
        /// <summary>True when the company has any notes of the given type (9 = Debit, 10 = Credit). Locks that starting number, mirroring invoices/challans.</summary>
        Task<bool> HasNotesForCompanyAsync(int companyId, int docType);
        Task<Dictionary<int, bool>> HasInvoicesForClientsAsync(IEnumerable<int> clientIds);
    }
}
