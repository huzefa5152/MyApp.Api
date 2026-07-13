using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Bank reconciliation read model + cleared-state toggles
    /// (BANK_RECONCILIATION_DESIGN.md). Pure metadata layer over the GL — marking
    /// a transaction cleared never moves money, it only shifts it out of the
    /// "pending" buckets so the Cleared balance can be matched to a bank statement.
    /// </summary>
    public interface IBankReconciliationService
    {
        /// <summary>Per bank/cash account: actual / cleared / pending-in / pending-out.</summary>
        Task<List<BankAccountReconSummaryDto>> GetAccountSummariesAsync(int companyId);

        /// <summary>Set or clear a payment/receipt's cleared date. Returns false if not found.</summary>
        Task<bool> SetPaymentClearedAsync(int paymentId, bool cleared, DateTime? clearedDate);

        /// <summary>Set or clear a transfer's cleared date (both legs). Returns false if not found.</summary>
        Task<bool> SetTransferClearedAsync(int transferId, bool cleared, DateTime? clearedDate);
    }
}
