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

        /// <summary>Every bank-affecting transaction for an account (receipts,
        /// payments, transfers), signed for the account, with its cleared state —
        /// the rows of the reconcile screen.</summary>
        Task<List<ReconcileTxnDto>> GetAccountTransactionsAsync(int accountId);

        /// <summary>Finalize a reconciliation: snapshot the cleared vs statement
        /// balance and lock cleared transactions dated on/before the statement date.</summary>
        Task<BankReconciliationDto> LockReconciliationAsync(int companyId, LockReconciliationDto dto);

        /// <summary>Locked reconciliation history for an account (newest first).</summary>
        Task<List<BankReconciliationDto>> GetReconciliationsAsync(int accountId);
    }
}
