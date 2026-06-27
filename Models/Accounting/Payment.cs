namespace MyApp.Api.Models.Accounting
{
    /// <summary>Money in (<see cref="Receipt"/>) vs money out (<see cref="Payment"/>).
    /// A single entity models both — the direction flips which party/document
    /// an allocation settles (Receipt → Client/Invoice, Payment → Supplier/Bill).</summary>
    public enum PaymentDirection { Receipt = 0, Payment = 1 }

    /// <summary>Lifecycle of a cheque / post-dated cheque (PDC). None = the payment
    /// wasn't a cheque (cash / bank transfer). Pending = cheque written, not yet
    /// cleared (a future <see cref="Payment.ChequeDate"/> means a PDC).</summary>
    public enum ChequeStatus { None = 0, Pending = 1, Deposited = 2, Cleared = 3, Bounced = 4 }

    /// <summary>
    /// A Receipt (money in) or Payment (money out) document — the AR/AP payment
    /// subledger. Phase A (design §11.5): delivers invoice/bill balance-due and
    /// payment status WITHOUT the GL. When the posting engine lands (Phase B),
    /// the same row also posts Dr/Cr (Bank ↔ AR/AP) — no rework, no re-model.
    ///
    /// One payment carries one or more <see cref="PaymentAllocation"/> lines, so a
    /// single receipt can settle many invoices (the legacy data has 1 payment
    /// clearing 7 bills). FBR is invoice-level only — receipts/payments are purely
    /// internal AR/AP, so this module has zero coupling to the FBR submit flow.
    /// </summary>
    public class Payment
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }

        public PaymentDirection Direction { get; set; }

        /// <summary>Auto-allocated sequence number, unique per
        /// (CompanyId, Direction). Displayed as RCP-#### / PMT-####. Allocated
        /// via <c>NumberAllocationRetry</c> so concurrent creates can't collide.
        /// The ETL importer preserves legacy document numbers by writing this
        /// directly.</summary>
        public int Number { get; set; }

        public DateTime Date { get; set; }

        // ── Contact (who paid / was paid) ──
        // ContactType is "Client" | "Supplier" | "Other". For an invoice-settling
        // receipt this is the Client; for a bill-settling payment, the Supplier.
        // "Other" (no ContactId) covers direct income/expense with no party.
        public string ContactType { get; set; } = "Other";
        public int? ContactId { get; set; }

        // ── Where the money landed / came from ──
        // BankAccountId is NULLABLE for now: the BankAccount subledger arrives in
        // the Chart-of-Accounts phase. Until then the operator picks via the
        // free-text BankAccountName + Method ("Cash" | "Bank Transfer" | "Cheque"
        // | "Online" | "Other"), and the FK is wired in when BankAccount exists.
        public int? BankAccountId { get; set; }
        public string? BankAccountName { get; set; }
        public string Method { get; set; } = "Cash";

        public string? Description { get; set; }

        /// <summary>Total amount of the document = Σ allocation amounts.
        /// decimal(18,2) to match Invoice/PurchaseBill money precision so paid
        /// totals reconcile exactly against grand totals (PKR is 2dp).</summary>
        public decimal Amount { get; set; }

        // ── Cheque / PDC (post-dated cheque) ──
        // A ChequeDate later than the document Date marks a PDC — the reality the
        // strategy doc targets. A "Cheque Register" view can come later.
        public string? ChequeNumber { get; set; }
        public DateTime? ChequeDate { get; set; }
        public ChequeStatus ChequeStatus { get; set; } = ChequeStatus.None;

        /// <summary>Void/cancel flag — mirrors Invoice.IsCancelled. A voided
        /// payment keeps its number but contributes nothing to AmountPaid. The
        /// legacy data has 181 voided payments + 85 voided receipts to carry.</summary>
        public bool IsCancelled { get; set; }
        public DateTime? CancelledAt { get; set; }
        public string? CancelReason { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<PaymentAllocation> Allocations { get; set; } = new List<PaymentAllocation>();
    }
}
