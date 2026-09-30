using MyApp.Api.Models;

namespace MyApp.Api.Repositories.Interfaces
{
    public interface IWithholdingTaxReceiptRepository
    {
        Task<List<WithholdingTaxReceipt>> GetByCompanyAsync(int companyId);
        Task<WithholdingTaxReceipt?> GetByIdAsync(int id);
        Task<WithholdingTaxReceipt> CreateAsync(WithholdingTaxReceipt receipt);
        Task<WithholdingTaxReceipt> UpdateAsync(WithholdingTaxReceipt receipt);
        Task DeleteAsync(WithholdingTaxReceipt receipt);
        Task<int> GetCountByCompanyAsync(int companyId);

        /// <summary>Highest receipt number in the given company
        /// sequence — 0 when none. Used for gap-free delete gating and the
        /// next-number allocation.</summary>
        Task<int> GetMaxNumberAsync(int companyId);
    }
}
