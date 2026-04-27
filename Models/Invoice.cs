namespace MyApp.Api.Models
{
    public class Invoice
    {
        public int Id { get; set; }
        public int InvoiceNumber { get; set; }
        public DateTime Date { get; set; }
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";
        public string? PaymentTerms { get; set; }

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

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
