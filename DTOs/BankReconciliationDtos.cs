namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Per bank/cash account reconciliation summary — the columns of the
    /// Bank &amp; Cash Accounts screen (design: BANK_RECONCILIATION_DESIGN.md §4.2).
    /// Invariant: <c>ActualBalance = ClearedBalance + PendingDeposits − PendingWithdrawals</c>.
    /// Actual is the GL balance (opening + posted movement); Cleared is derived by
    /// removing the not-yet-cleared (pending) receipts/payments/transfers.
    /// </summary>
    public class BankAccountReconSummaryDto
    {
        public int AccountId { get; set; }
        public string Name { get; set; } = "";
        public string? Code { get; set; }
        public decimal ActualBalance { get; set; }
        public decimal ClearedBalance { get; set; }
        public decimal PendingDeposits { get; set; }
        public decimal PendingWithdrawals { get; set; }
    }

    /// <summary>Toggle a receipt/payment/transfer's cleared state. When
    /// <see cref="Cleared"/> is true and no date is given, the document's own
    /// date is used as the cleared date.</summary>
    public class SetClearedDto
    {
        public bool Cleared { get; set; }
        public DateTime? ClearedDate { get; set; }
    }
}
