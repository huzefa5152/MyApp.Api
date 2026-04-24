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

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public ICollection<InvoiceItem> Items { get; set; } = new List<InvoiceItem>();
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
