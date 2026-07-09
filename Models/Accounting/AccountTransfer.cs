namespace MyApp.Api.Models.Accounting
{
    /// <summary>
    /// Inter-account transfer — money moved between two of the company's own
    /// bank/cash accounts (bank→cash drawer, bank→bank). A first-class document
    /// (the reference product's "Inter Account Transfers" tab) rather than a
    /// fake payment+receipt pair, so no contact is involved and the GL posting
    /// is simply Dr receiving account / Cr paying account.
    /// </summary>
    public class AccountTransfer
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Sequence unique per company (TRF-####), allocated max+1
        /// under NumberAllocationRetry.</summary>
        public int Number { get; set; }

        public DateTime Date { get; set; }

        /// <summary>Paying account (credited). Must be a bank/cash account of
        /// this company.</summary>
        public int FromAccountId { get; set; }

        /// <summary>Receiving account (debited). Must differ from FromAccountId.</summary>
        public int ToAccountId { get; set; }

        /// <summary>decimal(18,2) — matches Payment.Amount money precision.</summary>
        public decimal Amount { get; set; }

        public string? Description { get; set; }

        /// <summary>Optional reporting tag (same optional dimension as Payment).</summary>
        public int? DivisionId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Account FromAccount { get; set; } = null!;
        public Account ToAccount { get; set; } = null!;
    }
}
