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
        /// <summary>Resolved Client/Supplier name (null for "Other").</summary>
        public string? ContactName { get; set; }

        /// <summary>Optional Division tag and its resolved name.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public string Method { get; set; } = "Cash";
        public string? Description { get; set; }
        public decimal Amount { get; set; }

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
        public int? InvoiceId { get; set; }
        public int? InvoiceNumber { get; set; }
        public int? PurchaseBillId { get; set; }
        public int? PurchaseBillNumber { get; set; }
        public int? AccountId { get; set; }
        /// <summary>Human label of what this line settled, e.g. "Invoice #123".</summary>
        public string? DocumentLabel { get; set; }
        public decimal Amount { get; set; }
    }

    /// <summary>Create shape. Amount is derived server-side from the allocation
    /// lines (Σ). Number is optional — null/0 auto-allocates the next per
    /// (company, direction); the ETL importer supplies it to preserve legacy
    /// document numbers.</summary>
    public class CreatePaymentDto
    {
        public string Direction { get; set; } = "Receipt";
        public int? Number { get; set; }
        public DateTime Date { get; set; }

        public string ContactType { get; set; } = "Other";
        public int? ContactId { get; set; }

        /// <summary>Optional Division tag (validated against the company server-side).</summary>
        public int? DivisionId { get; set; }

        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public string Method { get; set; } = "Cash";
        public string? Description { get; set; }

        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        public string? ChequeStatus { get; set; }

        public List<CreatePaymentAllocationDto> Allocations { get; set; } = new();
    }

    public class CreatePaymentAllocationDto
    {
        public int? InvoiceId { get; set; }
        public int? PurchaseBillId { get; set; }
        public int? AccountId { get; set; }
        public decimal Amount { get; set; }
    }

    /// <summary>Cheque lifecycle update (PDC register): Pending, Deposited,
    /// Cleared or Bounced.</summary>
    public class UpdateChequeStatusDto
    {
        public string Status { get; set; } = "";
    }
}
