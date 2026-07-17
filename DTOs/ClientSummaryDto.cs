namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Per-client roll-up for the Customers screen — the TechvoLogix /
    /// Manager.io "Customers" columns: document counts, outstanding quantities,
    /// accounts receivable and withholding-tax receivable. Computed set-based
    /// per company (never persisted). Counts exclude demo / cancelled rows and
    /// credit/debit notes from the sales-invoice figure, matching the existing
    /// dashboard KPI conventions.
    /// </summary>
    public class ClientSummaryDto
    {
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        // ── Document counts ──
        public int SalesQuotes { get; set; }
        public int SalesOrders { get; set; }
        public int SalesInvoices { get; set; }
        public int CreditNotes { get; set; }
        public int DeliveryNotes { get; set; }

        // ── Outstanding quantities (net; can be negative when over-delivered) ──
        /// <summary>Σ(ordered − delivered) across the client's non-cancelled
        /// sales-order lines.</summary>
        public decimal QtyToDeliver { get; set; }
        /// <summary>Σ delivered quantity on the client's challans not yet billed
        /// (challan.InvoiceId is null).</summary>
        public decimal QtyToInvoice { get; set; }

        // ── Money ──
        /// <summary>Σ(GrandTotal − AmountPaid) over the client's sale invoices
        /// (excl. demo / cancelled / credit+debit notes).</summary>
        public decimal AccountsReceivable { get; set; }
        /// <summary>Σ of the client's Withholding Tax Receipts.</summary>
        public decimal WithholdingTaxReceivable { get; set; }

        /// <summary>"Paid" (AR == 0) / "Unpaid" (AR &gt; 0) / "Overpaid" (AR &lt; 0),
        /// matching the reference product's status column.</summary>
        public string Status { get; set; } = "Paid";
    }
}
