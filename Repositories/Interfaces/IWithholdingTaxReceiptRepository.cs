using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IWithholdingTaxReceiptRepository
    {
        Task<List<WithholdingTaxReceipt>> GetByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);
        Task<WithholdingTaxReceipt?> GetByIdAsync(int id);
        Task<WithholdingTaxReceipt> CreateAsync(WithholdingTaxReceipt receipt);
        Task<WithholdingTaxReceipt> UpdateAsync(WithholdingTaxReceipt receipt);
        Task DeleteAsync(WithholdingTaxReceipt receipt);
        Task<int> GetCountByCompanyAsync(int companyId, HashSet<int>? allowedDivisionIds = null);

        /// <summary>Highest receipt number in the given (company, division)
        /// sequence — 0 when none. Used for gap-free delete gating and the
        /// next-number allocation.</summary>
        Task<int> GetMaxNumberAsync(int companyId, int? divisionId);
    }
}
