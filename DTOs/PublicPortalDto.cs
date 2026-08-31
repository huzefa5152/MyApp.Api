namespace MyApp.Api.DTOs
{
    /// <summary>
    /// The public Customer Portal's wire shapes.
    ///
    /// These are WHITELISTS, not trimmed copies of the internal DTOs, and that is
    /// deliberate. <see cref="InvoiceDto"/> carries FBR IRNs, submission status and
    /// error text, IsFbrExcluded, IsDemo, ExternalRef and per-line adjustment
    /// overlays; <see cref="ClientDto"/> carries CNIC and the cross-tenant
    /// ClientGroupId. Reusing either and deleting fields would fail open the next
    /// time somebody adds a property. Everything below is listed because a
    /// customer is entitled to see it on their own invoice.
    /// </summary>
    public class PortalHeaderDto
    {
        public string CompanyName { get; set; } = "";
        public string? CompanyLogoPath { get; set; }
        public string? CompanyAddress { get; set; }
        public string? CompanyPhone { get; set; }
        /// <summary>Printed on the customer's own tax invoices, so not a secret.</summary>
        public string? CompanyNTN { get; set; }
        public string? CompanySTRN { get; set; }

        public string ClientName { get; set; } = "";

        /// <summary>
        /// False when the company has no Bill print template configured, in which
        /// case the portal hides Print and Download PDF rather than offering a
        /// button that can only fail.
        /// </summary>
        public bool CanPrint { get; set; }

        public PortalSummaryDto Summary { get; set; } = new();
    }

    /// <summary>
    /// Totals across EVERY invoice visible to this portal — computed server-side
    /// over the whole set, not just the current page, so the cards stay correct
    /// while paging.
    /// </summary>
    public class PortalSummaryDto
    {
        public int TotalInvoices { get; set; }
        public decimal TotalAmount { get; set; }
        public decimal PaidAmount { get; set; }
        /// <summary>
        /// What the customer owes across the WHOLE account, net of any advance
        /// they hold — the ledger's closing balance when positive, 0 when the
        /// customer is in credit. NOT a sum of per-invoice balances: an advance
        /// (unallocated receipt cash, or one invoice's overpayment) nets against
        /// what other invoices still owe rather than being invisible to it. See
        /// <see cref="MyApp.Api.Services.Interfaces.ICustomerLedgerService"/>.
        /// </summary>
        public decimal OutstandingAmount { get; set; }
        /// <summary>
        /// The advance the customer holds across the WHOLE account — the
        /// ledger's closing balance when negative, expressed positive, 0 when
        /// the customer owes. Mutually exclusive with <see cref="OutstandingAmount"/>:
        /// exactly one of the two is non-zero at a time, because both derive
        /// from the same single net position.
        /// </summary>
        public decimal OverpaidAmount { get; set; }

        public int PaidCount { get; set; }
        public int UnpaidCount { get; set; }
        public int PartiallyPaidCount { get; set; }
        public int OverpaidCount { get; set; }
        public int OverdueCount { get; set; }
    }

    public class PortalInvoiceListItemDto
    {
        /// <summary>
        /// The document number the customer already has on their copy. Used as
        /// the public identifier in place of the database id — every lookup is
        /// still scoped to the portal's company AND client server-side, so this
        /// can only ever address the customer's own invoices.
        /// </summary>
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public DateTime? DueDate { get; set; }

        /// <summary>Amount actually collectible — grand total less withholding tax.</summary>
        public decimal Total { get; set; }
        public decimal Paid { get; set; }
        public decimal Balance { get; set; }
        /// <summary>Non-zero only when the customer has over-paid.</summary>
        public decimal Credit { get; set; }
        /// <summary>Unpaid | PartiallyPaid | Paid | Overdue | Overpaid.</summary>
        public string Status { get; set; } = "";
        public int DaysOverdue { get; set; }
    }

    public class PortalInvoiceDetailDto
    {
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public DateTime? DueDate { get; set; }
        public string Status { get; set; } = "";
        public string? PaymentTerms { get; set; }
        /// <summary>The customer's own PO reference, when they gave one.</summary>
        public string? PoNumber { get; set; }
        public DateTime? PoDate { get; set; }

        public string ClientName { get; set; } = "";
        public string? ClientAddress { get; set; }
        public string? ClientPhone { get; set; }
        public string? ClientNTN { get; set; }

        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public decimal WithholdingTaxAmount { get; set; }
        /// <summary>Grand total less withholding tax — what the customer actually owes.</summary>
        public decimal Total { get; set; }
        public decimal Paid { get; set; }
        public decimal Balance { get; set; }
        public decimal Credit { get; set; }
        public string AmountInWords { get; set; } = "";

        public List<PortalInvoiceItemDto> Items { get; set; } = new();
    }

    public class PortalInvoiceItemDto
    {
        public string Description { get; set; } = "";
        public decimal Quantity { get; set; }
        public string UOM { get; set; } = "";
        public decimal UnitPrice { get; set; }
        public decimal LineTotal { get; set; }
        /// <summary>Printed on the tax invoice the customer already holds.</summary>
        public string? HSCode { get; set; }
    }

    /// <summary>
    /// Everything the portal page needs to render the SAME printed document the
    /// internal app produces, without publishing the template library.
    ///
    /// The server resolves which template applies (division first, then
    /// company-level, matching the export resolver) and hands down that one
    /// template's body plus the stamp map. The page merges it with the existing
    /// browser-side engine — the only merge engine that exists — and renders the
    /// result inside a sandboxed iframe, so operator-authored markup can style
    /// the document but can never execute.
    /// </summary>
    public class PortalPrintPayloadDto
    {
        public int InvoiceNumber { get; set; }
        /// <summary>Raw template body. Rendered sandboxed; never injected into the portal DOM.</summary>
        public string TemplateHtml { get; set; } = "";
        /// <summary>Merge data — the same print DTO the internal Bill print uses.</summary>
        public object PrintData { get; set; } = new();
        /// <summary>Stamp slug → public image URL, so a stamped template stays stamped.</summary>
        public Dictionary<string, string> StampMap { get; set; } = new();
        /// <summary>Suggested download filename, e.g. "Invoice-1042.pdf".</summary>
        public string FileNameBase { get; set; } = "";
    }
}
