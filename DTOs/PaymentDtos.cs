namespace MyApp.Api.DTOs
{
    /// <summary>Read shape for a Receipt/Payment document and its allocation
    /// lines. Direction / ChequeStatus travel as strings ("Receipt"/"Payment",
    /// "None"/"Pending"/…) to match the codebase's string-status convention.</summary>
    public class PaymentDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Direction { get; set; } = "Receipt";
        public int Number { get; set; }
        /// <summary>Display reference: "RCP-####" for receipts, "PMT-####" for payments.</summary>
        public string Reference { get; set; } = "";
        public DateTime Date { get; set; }

        public string ContactType { get; set; } = "Other";
        public int? ContactId { get; set; }
        /// <summary>Display name of the payee/payer: resolved from the
        /// Client/Supplier FK, or the stored free-text name for an "Other".</summary>
        public string? ContactName { get; set; }

        /// <summary>Optional Division tag and its resolved name.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public string Method { get; set; } = "Cash";
        public string? Description { get; set; }
        public decimal Amount { get; set; }
        /// <summary>Cash on this document that no allocation line spends —
        /// Amount − Σ allocation CASH. For a customer receipt this is the
        /// customer's advance. AdjustmentAmount is deliberately absent: it is a
        /// non-cash write-off that settles the invoice, not the receipt.</summary>
        public decimal UnallocatedAmount { get; set; }

        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        public string ChequeStatus { get; set; } = "None";
        /// <summary>True when ChequeDate is later than Date — a post-dated cheque.</summary>
        public bool IsPostDated { get; set; }

        public bool IsCancelled { get; set; }
        public DateTime CreatedAt { get; set; }

        public List<PaymentAllocationDto> Allocations { get; set; } = new();
    }

    public class PaymentAllocationDto
    {
        public int Id { get; set; }
        /// <summary>"Document" | "Account" | "OnAccount" — what this line is for.</summary>
        public string Kind { get; set; } = "Document";
        public int? InvoiceId { get; set; }
        public int? InvoiceNumber { get; set; }
        public int? PurchaseBillId { get; set; }
        public int? PurchaseBillNumber { get; set; }
        public int? AccountId { get; set; }
        /// <summary>Resolved name of the income/expense account on an Account line.</summary>
        public string? AccountName { get; set; }
        /// <summary>Human label of what this line settled, e.g. "Invoice #123",
        /// "Electricity" or "Advance".</summary>
        public string? DocumentLabel { get; set; }
        public decimal Amount { get; set; }
        /// <summary>Tax rate applied (18 = 18%); null when the line carries no tax.</summary>
        public decimal? TaxRate { get; set; }
        /// <summary>Tax included in <see cref="Amount"/> (0 = none).</summary>
        public decimal TaxAmount { get; set; }
        /// <summary>Amount net of tax — what hits the income/expense account.</summary>
        public decimal NetAmount { get; set; }
        /// <summary>Settle-remainder adjustment applied on this line (0 = none).</summary>
        public decimal AdjustmentAmount { get; set; }
        public int? AdjustmentAccountId { get; set; }
        /// <summary>Resolved name of the adjustment account (null when none).</summary>
        public string? AdjustmentAccountName { get; set; }
    }

    /// <summary>Create shape. Number is optional — null/0 auto-allocates the
    /// next per (company, direction); the ETL importer supplies it to preserve
    /// legacy document numbers.</summary>
    public class CreatePaymentDto
    {
        public string Direction { get; set; } = "Receipt";
        public int? Number { get; set; }
        public DateTime Date { get; set; }

        public string ContactType { get; set; } = "Other";
        public int? ContactId { get; set; }
        /// <summary>Free-text payee/payer name — only for ContactType "Other".
        /// Ignored (and cleared) for Client/Supplier, whose name comes from the FK.</summary>
        public string? ContactName { get; set; }

        /// <summary>Optional Division tag (validated against the company server-side).</summary>
        public int? DivisionId { get; set; }

        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public string Method { get; set; } = "Cash";
        public string? Description { get; set; }

        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        public string? ChequeStatus { get; set; }

        /// <summary>Cash total of the document. Authoritative — allocations may
        /// cover all, part, or none of it. The uncovered remainder is the
        /// customer's advance. Legacy callers that omit it fall back to
        /// Σ allocation amounts, preserving the old behaviour exactly.</summary>
        public decimal? Amount { get; set; }

        public List<CreatePaymentAllocationDto> Allocations { get; set; } = new();
    }

    public class CreatePaymentAllocationDto
    {
        /// <summary>"Document" (settle an invoice/bill) | "Account" (income/expense)
        /// | "OnAccount" (advance against the contact's balance). Optional — when
        /// omitted it is inferred from which id is set, so existing callers and the
        /// ETL importer keep working unchanged.</summary>
        public string? Kind { get; set; }
        public int? InvoiceId { get; set; }
        public int? PurchaseBillId { get; set; }
        public int? AccountId { get; set; }
        /// <summary>Cash applied to this document/account — GROSS, i.e. including
        /// any <see cref="TaxAmount"/>. This is what moves through the bank.</summary>
        public decimal Amount { get; set; }
        /// <summary>Tax rate for an Account line, as a percentage (18 = 18%). When
        /// supplied without <see cref="TaxAmount"/> the server derives the tax as
        /// the inclusive slice of Amount: Amount × rate / (100 + rate).</summary>
        public decimal? TaxRate { get; set; }
        /// <summary>Tax included in Amount. Optional — derived from
        /// <see cref="TaxRate"/> when null. Only valid on an Account line.</summary>
        public decimal? TaxAmount { get; set; }
        /// <summary>Optional "settle remainder" adjustment — a non-cash amount that
        /// also clears the settled invoice/bill (Amount + this = cleared). 0 = none.</summary>
        public decimal AdjustmentAmount { get; set; }
        /// <summary>GL account the adjustment posts to (required when the ledger is
        /// on and AdjustmentAmount > 0): Discount allowed, Bad debts, or any account.</summary>
        public int? AdjustmentAccountId { get; set; }
    }

    /// <summary>Cheque lifecycle update (PDC register): Pending, Deposited,
    /// Cleared or Bounced.</summary>
    public class UpdateChequeStatusDto
    {
        public string Status { get; set; } = "";
    }
}
