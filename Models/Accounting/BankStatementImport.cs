namespace MyApp.Api.Models.Accounting
{
    /// <summary>Lifecycle of an imported bank-statement line
    /// (the bank reconciliation design Phase 2).</summary>
    public enum BankStatementLineStatus { Uncategorized = 0, Categorized = 1, Ignored = 2 }

    /// <summary>One uploaded bank statement (a batch of <see cref="BankStatementLine"/>s)
    /// for a bank/cash account.</summary>
    public class BankStatementImport
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int BankAccountId { get; set; }
        public string FileName { get; set; } = "";
        public DateTime ImportedAt { get; set; } = DateTime.UtcNow;
        public int RowCount { get; set; }

        public Company Company { get; set; } = null!;
        public Account BankAccount { get; set; } = null!;
        public ICollection<BankStatementLine> Lines { get; set; } = new List<BankStatementLine>();
    }

    /// <summary>A single imported statement line. Until categorized it exists only
    /// here (no GL impact) — that's the "Uncategorized Receipts/Payments" the
    /// reference product shows. Categorizing it creates or links a Payment
    /// (<see cref="PaymentId"/>); ignoring drops it from the buckets.</summary>
    public class BankStatementLine
    {
        public int Id { get; set; }
        public int ImportId { get; set; }
        public int CompanyId { get; set; }
        public int BankAccountId { get; set; }
        public DateTime Date { get; set; }
        public string? Description { get; set; }
        /// <summary>Signed for the account: + deposit (money in), − withdrawal (money out).</summary>
        public decimal Amount { get; set; }
        public BankStatementLineStatus Status { get; set; } = BankStatementLineStatus.Uncategorized;
        /// <summary>The receipt/payment this line was matched to or created as.</summary>
        public int? PaymentId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public BankStatementImport Import { get; set; } = null!;
        public Account BankAccount { get; set; } = null!;
    }
}
