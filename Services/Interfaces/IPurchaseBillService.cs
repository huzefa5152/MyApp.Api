using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IPurchaseBillService
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope from
        /// IDivisionAccessGuard: non-null = restricted user, return only rows in
        /// these divisions or with no division (policy D1). Null = unrestricted.</param>
        Task<PagedResult<PurchaseBillDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
        Task<PurchaseBillDto?> GetByIdAsync(int id);
        /// <summary>Flat merge-data payload for the PurchaseBill print templates.</summary>
        Task<PrintPurchaseBillDto?> GetPrintDataAsync(int id);
        Task<PurchaseBillDto> CreateAsync(CreatePurchaseBillDto dto);
        Task<PurchaseBillDto?> UpdateAsync(int id, UpdatePurchaseBillDto dto);
        /// <summary>Set (or clear, when null) the bill's payment due date —
        /// drives the Overdue/Coming-due status (design §11.5).</summary>
        Task<PurchaseBillDto?> SetDueDateAsync(int id, DateTime? dueDate);
        Task<bool> DeleteAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<Dictionary<int, int>> GetCountsBySupplierAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
    }
}
