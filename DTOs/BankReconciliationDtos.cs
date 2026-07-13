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

    /// <summary>One bank-affecting transaction for the reconcile screen. Amount is
    /// signed FOR THIS ACCOUNT (+ deposit / − withdrawal).</summary>
    public class ReconcileTxnDto
    {
        public string DocType { get; set; } = "";   // "Receipt" | "Payment" | "Transfer"
        public int DocId { get; set; }
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }
        public string? Description { get; set; }
        public decimal Amount { get; set; }
        public bool Cleared { get; set; }
    }

    /// <summary>Finalize (lock) a reconciliation of a bank account against a
    /// statement's ending balance as of a date.</summary>
    public class LockReconciliationDto
    {
        public int BankAccountId { get; set; }
        public DateTime StatementDate { get; set; }
        public decimal StatementBalance { get; set; }
    }

    /// <summary>A locked reconciliation record (history row).</summary>
    public class BankReconciliationDto
    {
        public int Id { get; set; }
        public int BankAccountId { get; set; }
        public DateTime StatementDate { get; set; }
        public decimal StatementBalance { get; set; }
        public decimal ClearedBalance { get; set; }
        public decimal Difference { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
