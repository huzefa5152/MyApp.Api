namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// A locked bank-reconciliation snapshot (the bank reconciliation design
    /// Phase 3). At <see cref="StatementDate"/> the bank statement's ending
    /// balance was <see cref="StatementBalance"/>, and the book's cleared balance
    /// (<see cref="ClearedBalance"/>) was reconciled against it. Live ticking of
    /// transactions happens on Payment/AccountTransfer.ReconciledDate; creating
    /// one of these records "locks" that point in time — cleared transactions
    /// dated on/before StatementDate can no longer be un-cleared.
    /// </summary>
    public class BankReconciliation
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int BankAccountId { get; set; }
        public DateTime StatementDate { get; set; }
        public decimal StatementBalance { get; set; }
        public decimal ClearedBalance { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Account BankAccount { get; set; } = null!;
    }
}
