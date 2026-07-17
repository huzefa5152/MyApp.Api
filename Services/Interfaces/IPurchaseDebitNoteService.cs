using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Purchase (supplier-side) debit notes — full CRUD. User-created
    /// notes post GL (Dr AP / Cr inventory-or-account / Cr input tax) and move
    /// stock OUT when they carry an item type; migration-created notes stay lean
    /// (no GL, no stock). The Manager.io import is the other writer.</summary>
    public interface IPurchaseDebitNoteService
    {
        Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PurchaseDebitNoteDto?> GetByIdAsync(int id);
        Task<PrintPurchaseDebitNoteDto?> GetPrintDataAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PurchaseDebitNoteDto> CreateAsync(CreatePurchaseDebitNoteDto dto);
        Task<PurchaseDebitNoteDto?> UpdateAsync(int id, UpdatePurchaseDebitNoteDto dto);
        Task<bool> DeleteAsync(int id);
    }
}
