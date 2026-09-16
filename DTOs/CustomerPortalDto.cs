namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Management-side view of a portal. Carries the live
    /// <see cref="PublicUrl"/>, because handing that link to an operator is the
    /// whole point of the screen — which also means this DTO holds a bearer
    /// secret and must never be logged, audited, or returned from anything but
    /// the permission-gated management endpoints.
    /// </summary>
    public class CustomerPortalDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>The full link to give the customer, built server-side.</summary>
        public string PublicUrl { get; set; } = "";

        public bool IsActive { get; set; }

        /// <summary>"Bill" | "TaxInvoice" | null (choose automatically).</summary>
        public string? DocumentType { get; set; }
        /// <summary>Friendly name for the row: "Bill", "Tax Invoice" or "Automatic".</summary>
        public string DocumentTypeLabel { get; set; } = "";
        /// <summary>False when the chosen document has no template on this
        /// company — the customer would see no Print, so the row can warn.</summary>
        public bool TemplateAvailable { get; set; }
        /// <summary>Which document types this company actually has templates
        /// for, so the row can offer a switch without offering a dead option.</summary>
        public List<string> AvailableDocumentTypes { get; set; } = new();

        public DateTime CreatedAt { get; set; }
        public DateTime? DisabledAt { get; set; }
    }

    /// <summary>Which invoice documents a company can actually produce.</summary>
    public class PortalDocumentOptionDto
    {
        public string Type { get; set; } = "";
        public string Label { get; set; } = "";
        /// <summary>False when the company has no template of this type yet.</summary>
        public bool Available { get; set; }
    }

    public class CreateCustomerPortalDto
    {
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        /// <summary>"Bill" or "TaxInvoice". Null lets the server choose.</summary>
        public string? DocumentType { get; set; }
    }

    public class SetPortalDocumentTypeDto
    {
        public string? DocumentType { get; set; }
    }

    public class SetCustomerPortalActiveDto
    {
        public bool IsActive { get; set; }
    }

    // ── The public surface ─────────────────────────────────────────────────
    //
    // Everything below is served to an ANONYMOUS caller, so each field is here
    // because the customer needs it. Nothing carries an internal id the caller
    // could feed back: an invoice is addressed by the NUMBER printed on the
    // document they already hold.

    public class PortalSummaryDto
    {
        public int TotalInvoices { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        public decimal OutstandingAmount { get; set; }
        public int PaidCount { get; set; }
        public int UnpaidCount { get; set; }
        public int PartiallyPaidCount { get; set; }
        public int OverdueCount { get; set; }
    }

    /// <summary>What the customer sees at the top of their portal: who is
    /// billing them, who they are, and where they stand overall.</summary>
    public class PortalHeaderDto
    {
        public string CompanyName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        public string? CompanyNtn { get; set; }
        public string ClientName { get; set; } = "";
        /// <summary>"Bill" | "TaxInvoice" — which document Print produces.</summary>
        public string DocumentType { get; set; } = "";
        /// <summary>False when the company has no template for it, so the page
        /// hides Print rather than offering a button that fails.</summary>
        public bool CanPrint { get; set; }
        public PortalSummaryDto Summary { get; set; } = new();
    }

    public class PortalInvoiceListItemDto
    {
        /// <summary>The number printed on the customer's own copy. This is how
        /// an invoice is addressed from the portal — there is no database id in
        /// this DTO, so there is none to substitute.</summary>
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public DateTime? DueDate { get; set; }
        public string? PoNumber { get; set; }
        /// <summary>What the customer owes on this invoice: the grand total less
        /// anything withheld at source, which they never pay us.</summary>
        public decimal Amount { get; set; }
        public decimal AmountPaid { get; set; }
        public decimal BalanceDue { get; set; }
        public string PaymentStatus { get; set; } = "";
        public int DaysOverdue { get; set; }
    }

    public class PortalInvoiceLineDto
    {
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string Uom { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
    }

    public class PortalInvoiceDetailDto
    {
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public DateTime? DueDate { get; set; }
        public string? PoNumber { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GstRate { get; set; }
        public decimal GstAmount { get; set; }
        public decimal FurtherTaxAmount { get; set; }
        public decimal WithholdingTaxAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal Amount { get; set; }
        public decimal AmountPaid { get; set; }
        public decimal BalanceDue { get; set; }
        public string PaymentStatus { get; set; } = "";
        public int DaysOverdue { get; set; }
        public string? AmountInWords { get; set; }
        public List<PortalInvoiceLineDto> Lines { get; set; } = new();
    }

    /// <summary>Template plus merge data for one invoice. The template library
    /// is never published — the server resolves the company's default and sends
    /// only the one document's worth of HTML and data.</summary>
    public class PortalPrintPayloadDto
    {
        public string DocumentType { get; set; } = "";
        public string TemplateHtml { get; set; } = "";
        public object Data { get; set; } = new();
    }
}
