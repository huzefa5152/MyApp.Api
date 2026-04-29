namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="Invoice"/> for the purchase side. Represents a
    /// sales-tax invoice that a <see cref="Supplier"/> issued to this
    /// Company. We do NOT transmit it to FBR — the supplier already did
    /// that — but we record their IRN so it can be reconciled against
    /// IRIS Annexure-A at filing time, and we use the GST amount as input
    /// tax to offset our output tax in the monthly Sales Tax Return.
    /// </summary>
    public class PurchaseBill
    {
        public int Id { get; set; }
        public int PurchaseBillNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int SupplierId { get; set; }

        /// <summary>
        /// The bill number the supplier put on their printed invoice. Free
        /// text — different suppliers use different formats (POGI-1234,
        /// 2026/045, plain numeric). Used when reconciling against the
        /// supplier's records during a dispute.
        /// </summary>
        public string? SupplierBillNumber { get; set; }

        /// <summary>
        /// The IRN the supplier received from PRAL when they posted the
        /// invoice. This is the SHARED KEY between this row and the FBR /
        /// IRIS Annexure-A row that auto-populates on the buyer's side. A
        /// purchase without an IRN is either pre-FBR or non-compliant
        /// supplier — input-tax claim won't survive STRIVe matching.
        /// </summary>
        public string? SupplierIRN { get; set; }

        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }

        // FBR digital-invoicing classification — copied from supplier's
        // invoice for completeness (informational; we don't post this).
        public int? DocumentType { get; set; }
        public string? PaymentMode { get; set; }

        /// <summary>
        /// Reconciliation state vs IRIS Annexure-A. Updated by the
        /// reconciliation job (Phase 7+):
        ///   • "Pending"    — entered locally, not yet seen in Annexure-A
        ///   • "Matched"    — supplier filed it; input tax claim is safe
        ///   • "Disputed"   — amount/items don't match Annexure-A
        ///   • "ManualOnly" — IRN missing; never reconciled
        /// </summary>
        public string ReconciliationStatus { get; set; } = "Pending";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Supplier Supplier { get; set; } = null!;
        public ICollection<PurchaseItem> Items { get; set; } = new List<PurchaseItem>();
        public ICollection<GoodsReceipt> GoodsReceipts { get; set; } = new List<GoodsReceipt>();

        // The "links to sale bills" relationship is N:M between PurchaseBills
        // and Invoices, expressed at the LINE level via
        // PurchaseItem.SourceInvoiceItemId. Compute "this purchase covers
        // sale bills X, Y, Z" by grouping Items.Select(i =>
        // i.SourceInvoiceItem?.InvoiceId).Distinct() — no bill-level FK
        // needed, and one purchase bill can fulfill any number of sale bills.
    }
}
