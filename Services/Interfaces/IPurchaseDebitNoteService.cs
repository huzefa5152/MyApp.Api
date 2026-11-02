using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    public interface IPurchaseDebitNoteService
    {
        Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId);
        Task<PurchaseDebitNoteDto?> GetByIdAsync(int id);
        Task<PrintPurchaseDebitNoteDto?> GetPrintDataAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId);
        Task<PurchaseDebitNoteDto> CreateAsync(CreatePurchaseDebitNoteDto dto);
        Task<PurchaseDebitNoteDto?> UpdateAsync(int id, UpdatePurchaseDebitNoteDto dto);
        Task<bool> DeleteAsync(int id);
    }
}
