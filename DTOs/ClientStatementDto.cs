namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Customer Accounts-Receivable statement — a single chronological ledger
    /// interleaving sale invoices (debits) and receipt allocations (credits)
    /// with a running balance, the way the reference product shows it when you
    /// click a customer's A/R amount. Σ(debits) − Σ(credits) equals the A/R
    /// figure on the Customers screen (receipt allocations are exactly the
    /// invoices' AmountPaid). Entries are newest-first; each carries the running
    /// balance AS OF that transaction (so the top row is the current balance).
    /// </summary>
    public class ClientStatementDto
    {
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>Current outstanding receivable — equals the A/R column.</summary>
        public decimal ClosingBalance { get; set; }

        /// <summary>Total ledger entries before the display cap.</summary>
        public int Total { get; set; }
        /// <summary>True when older entries were omitted (only the most recent
        /// are returned); each returned row still carries its true running
        /// balance.</summary>
        public bool Capped { get; set; }

        public List<ClientStatementEntryDto> Entries { get; set; } = new();
    }

    public class ClientStatementEntryDto
    {
        public DateTime Date { get; set; }
        /// <summary>"Sales Invoice" | "Receipt".</summary>
        public string Type { get; set; } = "";
        /// <summary>Human reference, e.g. "INV-6185" / "RCP-696".</summary>
        public string Reference { get; set; } = "";
        /// <summary>Underlying document id (invoice id / payment id).</summary>
        public int DocId { get; set; }
        public string? Description { get; set; }
        /// <summary>Bank/cash account the money landed in (receipts).</summary>
        public string? BankAccount { get; set; }

        /// <summary>Increases the receivable (sale invoice).</summary>
        public decimal Debit { get; set; }
        /// <summary>Decreases the receivable (receipt allocation).</summary>
        public decimal Credit { get; set; }
        /// <summary>Running balance as of this entry (chronological).</summary>
        public decimal Balance { get; set; }
    }
}
