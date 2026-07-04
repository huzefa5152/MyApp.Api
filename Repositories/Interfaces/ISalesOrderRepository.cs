using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface ISalesOrderRepository
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope: when non-null the
        /// caller is division-restricted and only rows tagged with one of these
        /// divisions (or no division — company-level rows stay shared, policy D1)
        /// are returned. Null = unrestricted, no filter.</param>
        Task<List<SalesOrder>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<(List<SalesOrder> Items, int TotalCount)> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, string? status = null,
            int? clientId = null, DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
        Task<SalesOrder?> GetByIdAsync(int id);
        Task<SalesOrder> UpdateAsync(SalesOrder order);
        Task DeleteAsync(SalesOrder order);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<int> GetMaxNumberAsync(int companyId);
        Task<bool> HasChallansAsync(int salesOrderId);
        /// <summary>Orders with at least one undelivered line — powers the "open orders" picker.</summary>
        Task<List<SalesOrder>> GetOpenByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
    }
}
