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
        /// buttons still work — the flag gates BULK actions.
        /// 2026-07-02: the flag now ALSO gates inventory — an excluded bill
        /// holds no stock movements (its deduction is reversed on exclude and
        /// re-recorded on re-include, classified HS-coded lines only). The
        /// toggle is rejected once the bill is FBR-submitted.
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
        // ── Credit / Debit Note linkage (2026-07-01) ─────────────────────
        // A Credit Note (DocumentType 10) or Debit Note (DocumentType 9) is
        // itself an Invoice row that ADJUSTS an earlier FBR-submitted sale.
        // These fields link the note back to the original invoice.
        //
        // IMPORTANT: FbrIRN above always means "THIS document's own IRN"
        // (a note gets its own IRN when submitted). The *reference* to the
        // original invoice's IRN is stored separately here so submitting the
        // note never clobbers the reference. FbrService reads
        // OriginalInvoiceRefIRN for the FBR `invoiceRefNo` field on notes.

        /// <summary>Local FK to the original invoice this note reverses/adjusts. Null for ordinary sale invoices.</summary>
        public int? OriginalInvoiceId { get; set; }

        /// <summary>
        /// Header-level lineage to the Sales Order this bill fulfils, when the
        /// bill was created via the SO→bill prefill flow (2026-07 inventory
        /// redesign — closes the missing SO↔invoice link). Nullable NoAction
        /// FK. Line-level fulfilment uses InvoiceItem.SalesOrderItemId; this
        /// header pointer is the fast filter for "bills against order X".
        /// Company-validated on write (never trusted from the DTO).
        /// </summary>
        public int? SalesOrderId { get; set; }

        /// <summary>
        /// The ORIGINAL invoice's FBR IRN (22 digits NTN / 28 digits CNIC).
        /// Sent to FBR as `invoiceRefNo` for Debit/Credit Notes (FBR 0026).
        /// Distinct from <see cref="FbrIRN"/>, which is this note's own IRN.
        /// </summary>
        public string? OriginalInvoiceRefIRN { get; set; }

        /// <summary>FBR reason for the note (goods returned, cancellation, etc). Required for notes (FBR 0027).</summary>
        public string? NoteReason { get; set; }

        /// <summary>Free-text remarks — required by FBR when the reason is "Others" (FBR 0028).</summary>
        public string? NoteReasonRemarks { get; set; }

        /// <summary>
        /// PERSISTED COMPUTED column (see AppDbContext): 0 = sale invoice,
        /// 1 = Debit Note (DocumentType 9), 2 = Credit Note (DocumentType 10).
        /// Each kind numbers from its own per-company sequence, so the
        /// (CompanyId, InvoiceNumber) uniqueness is scoped per kind — the
        /// unique index is (CompanyId, NoteKind, InvoiceNumber). Never set
        /// from code.
        /// </summary>
        public byte NoteKind { get; private set; }

        /// <summary>
        /// Notes only (null on sale invoices): whether this note moves
        /// inventory. Industry pattern (SAP returns-vs-credit-memo, Zoho
        /// restock-vs-credit-only): a goods return (Credit Note, reason
        /// "Return of goods"/"Cancellation of supply") re-enters stock; a
        /// value-only adjustment (discount, rate change, undercharge Debit
        /// Note) must NOT touch stock. Derived from the reason at creation,
        /// operator-overridable. Direction when true: Credit Note → IN,
        /// Debit Note → OUT (extra goods shipped).
        /// </summary>
        public bool? NoteAffectsStock { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Division? Division { get; set; }
        public Client Client { get; set; } = null!;
        public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();

        /// <summary>Self-reference to the original invoice a Credit/Debit Note adjusts. Null for ordinary invoices.</summary>
        public Invoice? OriginalInvoice { get; set; }
    }
}
