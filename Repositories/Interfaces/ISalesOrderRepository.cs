using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ISalesOrderRepository
    {
        Task<List<SalesOrder>> GetByCompanyAsync(int companyId);
        Task<(List<SalesOrder> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null);
        Task<SalesOrder?> GetByIdAsync(int id);
        Task<SalesOrder> UpdateAsync(SalesOrder order);
        Task DeleteAsync(SalesOrder order);
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<int> GetMaxNumberAsync(int companyId);
        Task<bool> HasChallansAsync(int salesOrderId);
        /// <summary>Orders with at least one undelivered line — powers the "open orders" picker.</summary>
        Task<List<SalesOrder>> GetOpenByCompanyAsync(int companyId);
    }
}
