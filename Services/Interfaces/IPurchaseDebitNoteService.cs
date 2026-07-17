using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>Purchase (supplier-side) debit notes — read + delete. Creation
    /// is done by the Manager.io import; a manual create form can follow later.</summary>
    public interface IPurchaseDebitNoteService
    {
        Task<List<PurchaseDebitNoteDto>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<PurchaseDebitNoteDto?> GetByIdAsync(int id);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<bool> DeleteAsync(int id);
    }
}
