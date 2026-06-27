namespace MyApp.Api.Models
{
    public class Invoice
    {
        public int Id { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        /// <summary>Optional division ("sub-company"); when set the bill/invoice
        /// numbers from the division's own sequence. Null = company-level.</summary>
        public int? DivisionId { get; set; }
        public int ClientId { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }

        // ── Payments / Receipts (AR subledger — design §11.5) ──
        // DueDate drives the Overdue/Coming-due status; null = no terms set.
        // AmountPaid is the Σ of receipt allocations to this invoice, kept in
        // sync inside the allocation transaction (avoids an N+1 on list views).
        // BalanceDue (= GrandTotal − AmountPaid) and the payment status are
        // DERIVED at read time so "Overdue" stays correct as the clock advances
        // without needing a write — see PaymentStatusCalculator.
        public DateTime? DueDate { get; set; }
        public decimal AmountPaid { get; set; }

        // FBR Digital Invoicing
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }
        public string? FbrInvoiceNumber { get; set; }
        public string? FbrIRN { get; set; }
        public string? FbrStatus { get; set; }
        public DateTime? FbrSubmittedAt { get; set; }
        public string? FbrErrorMessage { get; set; }

        /// <summary>
        /// When true, this bill is excluded from the Validate All / Submit All
        /// bulk buttons. Operators toggle this for bills they deliberately
        /// don't want to report to FBR (e.g. internal sample invoices,
        /// cancelled-but-retained records). The per-bill Validate / Submit
        /// buttons still work — the flag only gates BULK actions.
        /// </summary>
        public bool IsFbrExcluded { get; set; }

        /// <summary>
        /// True when this bill was created via the FBR Sandbox tab (used to
        /// validate scenarios against PRAL without consuming the company's
        /// real bill numbering). Demo bills:
        ///  • Use a separate number range starting at 900000+ so they never
        ///    collide with real bills.
        ///  • Do NOT bump the company's CurrentInvoiceNumber.
        ///  • Are filtered out of the regular Bills page by default.
        ///  • Are listed only in the FBR Sandbox tab.
        /// </summary>
        public bool IsDemo { get; set; }

        /// <summary>
        /// True when this bill has been VOIDED/CANCELLED. A cancelled bill
        /// keeps its <see cref="InvoiceNumber"/> (so the sequence stays
        /// gap-free — no renumbering), but is treated as a non-document
        /// everywhere it matters:
        ///   • Excluded from every dashboard KPI (like <see cref="IsDemo"/>).
        ///   • Cannot be edited or sent to FBR.
        ///   • Its linked delivery challans are released back to a billable
        ///     state so they can be re-billed.
        /// Only non-FBR-submitted bills can be cancelled — a submitted bill
        /// must be reversed with a Credit Note, never voided.
        /// </summary>
        public bool IsCancelled { get; set; }
        public DateTime? CancelledAt { get; set; }
        public string? CancelReason { get; set; }

        /// <summary>True when this bill was brought in by the legacy data
        /// migration (historical, pre-FBR). Such bills are force-excluded from
        /// FBR (IsFbrExcluded) and tagged for traceability. ExternalRef carries
        /// the legacy "sinv:{DocumentNumber}" so the ETL is idempotent.</summary>
        public bool IsMigrated { get; set; }
        public string? ExternalRef { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Client Client { get; set; } = null!;
        public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
