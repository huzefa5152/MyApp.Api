namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Supplier ledger — the payables mirror of <see cref="ClientStatementDto"/>:
    /// every purchase bill, payment, advance and refund for one supplier in date
    /// order, with a running balance.
    ///
    /// Sides follow proper AP convention: a bill is a CREDIT (it increases what we
    /// owe) and a payment is a DEBIT (it reduces it). <see cref="ClosingBalance"/>
    /// is therefore reported as credit-positive — a positive number means we owe
    /// the supplier that much, which is what the screen shows. That is the
    /// opposite sign convention to the customer statement, because a customer
    /// balance is an asset and a supplier balance is a liability.
    /// </summary>
    public class SupplierStatementDto
    {
        public int SupplierId { get; set; }
        public string SupplierName { get; set; } = "";
        /// <summary>Amount owed to the supplier after every entry below.
        /// Negative = we have paid ahead and they owe us.</summary>
        public decimal ClosingBalance { get; set; }
        /// <summary>Total entries that exist, before the display cap.</summary>
        public int Total { get; set; }
        /// <summary>True when older entries were trimmed off the response.</summary>
        public bool Capped { get; set; }
        public List<SupplierStatementEntryDto> Entries { get; set; } = new();
    }

    public class SupplierStatementEntryDto
    {
        public DateTime Date { get; set; }
        /// <summary>"Purchase Bill" | "Payment" | "Advance paid" | "Refund received".</summary>
        public string Type { get; set; } = "";
        /// <summary>Human reference, e.g. "BILL-1087" / "PMT-1554".</summary>
        public string Reference { get; set; } = "";
        /// <summary>Underlying document id (purchase bill id / payment allocation id).</summary>
        public int DocId { get; set; }
        public string? Description { get; set; }
        /// <summary>Bank/cash account the money moved through (payments).</summary>
        public string? BankAccount { get; set; }

        /// <summary>Reduces what we owe — a payment made, or an advance paid.</summary>
        public decimal Debit { get; set; }
        /// <summary>Increases what we owe — a purchase bill, or a refund received.</summary>
        public decimal Credit { get; set; }
        /// <summary>Running amount owed after this entry.</summary>
        public decimal Balance { get; set; }
    }
}
