using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IGoodsReceiptService
    {
        Task<PagedResult<GoodsReceiptDto>> GetPagedByCompanyAsync(
            int companyId, int page, int pageSize,
            string? search = null, int? supplierId = null,
            string? status = null,
            DateTime? dateFrom = null, DateTime? dateTo = null);
        Task<GoodsReceiptDto?> GetByIdAsync(int id);
        Task<GoodsReceiptDto> CreateAsync(CreateGoodsReceiptDto dto);
        Task<GoodsReceiptDto?> UpdateAsync(int id, UpdateGoodsReceiptDto dto);
        Task<bool> DeleteAsync(int id);
    }
}
