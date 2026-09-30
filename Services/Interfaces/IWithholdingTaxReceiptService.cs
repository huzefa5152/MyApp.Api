using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IWithholdingTaxReceiptService
    {
        Task<List<WithholdingTaxReceiptDto>> GetByCompanyAsync(int companyId);
        Task<WithholdingTaxReceiptDto?> GetByIdAsync(int id);
        Task<WithholdingTaxReceiptDto> CreateAsync(int companyId, WithholdingTaxReceiptDto dto);
        Task<WithholdingTaxReceiptDto?> UpdateAsync(int id, WithholdingTaxReceiptDto dto);
        Task<bool> DeleteAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<PrintWithholdingReceiptDto?> GetPrintDataAsync(int id);
    }
}
