using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IGoodsReceiptService
    {
        /// <param name="allowedDivisionIds">Division-RBAC scope from
        /// IDivisionAccessGuard: non-null = restricted user, return only rows in
        /// these divisions or with no division (policy D1). Null = unrestricted.</param>
        Task<PagedResult<GoodsReceiptDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            string? status = null,
            DateTime? dateFrom = null, DateTime? dateTo = null,
            int? divisionId = null, HashSet<int>? allowedDivisionIds = null);
        Task<GoodsReceiptDto?> GetByIdAsync(int id);
        /// <summary>Flat merge-data payload for the GoodsReceipt print templates.</summary>
        Task<PrintGoodsReceiptDto?> GetPrintDataAsync(int id);
        Task<GoodsReceiptDto> CreateAsync(CreateGoodsReceiptDto dto);
        Task<GoodsReceiptDto?> UpdateAsync(int id, UpdateGoodsReceiptDto dto);
        Task<bool> DeleteAsync(int id);
    }
}
