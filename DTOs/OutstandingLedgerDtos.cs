namespace MyApp.Api.DTOs
{
    /// <summary>
    /// One receipt applied to an invoice, surfaced on the Outstanding Ledger so
    /// the operator sees HOW a bill was (partly) settled — cheque #, online ref,
    /// date, amount. Sourced from PaymentAllocation → parent Payment (Receipts).
    /// </summary>
    public class OutstandingLedgerPaymentDto
    {
        public string Number { get; set; } = "";        // e.g. RCP-42
        public System.DateTime Date { get; set; }
        public string Method { get; set; } = "";         // Cash | Cheque | Online | Bank Transfer | Other
        public string? ChequeNumber { get; set; }
        public System.DateTime? ChequeDate { get; set; }
        public string? ChequeStatus { get; set; }         // null unless a cheque
        public string? Reference { get; set; }            // bank/account name
        public decimal Amount { get; set; }
        /// <summary>Pre-formatted one-liner for the Excel/PDF "Payment Details" cell.</summary>
        public string Label { get; set; } = "";
    }

    /// <summary>One invoice row of the Outstanding Ledger (client statement).</summary>
    public class OutstandingLedgerRowDto
    {
        public int InvoiceId { get; set; }
        public int SerialNo { get; set; }
        public string PoNumber { get; set; } = "";
        /// <summary>Earliest linked delivery-challan date; null when the bill has no challan.</summary>
        public System.DateTime? DeliveryDate { get; set; }
        /// <summary>Invoice date — shown as "Invoice Receiving Date" on the sheet.</summary>
        public System.DateTime InvoiceDate { get; set; }
        /// <summary>Linked delivery-challan number(s), e.g. "4150/4071".</summary>
        public string DcNumbers { get; set; } = "";
        public string BillNumber { get; set; } = "";      // invoice number
        public decimal Amount { get; set; }               // GrandTotal (incl tax)
        public decimal Paid { get; set; }
        public decimal Balance { get; set; }              // outstanding
        public string Status { get; set; } = "";          // Unpaid | PartiallyPaid | Paid | Overdue
        public System.Collections.Generic.List<OutstandingLedgerPaymentDto> Payments { get; set; } = new();
        /// <summary>All payment labels joined for a single-cell display.</summary>
        public string PaymentSummary { get; set; } = "";
    }

    /// <summary>
    /// Outstanding Ledger for one company + (optional) client: every sale invoice
    /// with its amount / paid / balance / payment status and the receipts that
    /// settled it. Filterable by payment status (all | unpaid | paid). "Amount
    /// Receivable" mirrors the operator's manual outstanding sheet.
    /// </summary>
    public class OutstandingLedgerDto
    {
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int? ClientId { get; set; }
        public string ClientName { get; set; } = "";
        public string StatusFilter { get; set; } = "unpaid";   // all | unpaid | paid
        public int? Year { get; set; }
        public int? Month { get; set; }
        public string PeriodLabel { get; set; } = "";
        public System.Collections.Generic.List<OutstandingLedgerRowDto> Rows { get; set; } = new();
        public decimal GrandAmount { get; set; }
        public decimal GrandPaid { get; set; }
        public decimal GrandBalance { get; set; }
        public int InvoiceCount { get; set; }
    }
}
