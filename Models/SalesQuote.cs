namespace MyApp.Api.Models
{
    /// <summary>
    /// A price quotation sent to a customer in response to their enquiry.
    /// This is the pre-sale, PRICED document: the customer asks "what would
    /// X, Y, Z cost?" and the company replies with a quote. A quote can later
    /// be converted into a <see cref="SalesOrder"/> (which is quantity-only —
    /// pricing is re-entered at bill time).
    ///
    /// Mirrors the numbering / tenant / lifecycle conventions of
    /// <see cref="DeliveryChallan"/> and <see cref="Invoice"/>:
    ///  • QuoteNumber is unique per CompanyId (service enforces on create).
    ///  • CompanyId-scoped; every endpoint asserts access.
    /// Quotes are NOT FBR documents — they never touch PRAL.
    /// </summary>
    public class SalesQuote
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public int QuoteNumber { get; set; }
        public int ClientId { get; set; }

        /// <summary>
        /// Optional sub-brand / department this quote belongs to (a
        /// <see cref="Division"/> of the same company). Null = company-level.
        /// </summary>
        public int? DivisionId { get; set; }

        public DateTime Date { get; set; }
        /// <summary>Optional quote validity / expiry date shown on the print.</summary>
        public DateTime? ValidUntil { get; set; }

        /// <summary>
        /// The customer's enquiry reference (their RFQ number) this quote
        /// answers. Free text — left null when the enquiry was verbal.
        /// </summary>
        public string? CustomerEnquiryRef { get; set; }
        public DateTime? EnquiryDate { get; set; }

        /// <summary>Free-text terms / notes printed at the foot of the quote.</summary>
        public string? Notes { get; set; }

        // Priced totals — same money precision contract as Invoice.
        public decimal Subtotal { get; set; }
        public decimal GSTRate { get; set; }
        public decimal GSTAmount { get; set; }
        public decimal GrandTotal { get; set; }
        public string AmountInWords { get; set; } = "";

        /// <summary>
        /// Lifecycle: Draft → Sent → Accepted / Rejected / Expired.
        /// Set to "Converted" once turned into a Sales Order so the operator
        /// can see at a glance which quotes won.
        /// </summary>
        public string Status { get; set; } = "Draft";

        /// <summary>Set when this quote has been converted into a Sales Order.</summary>
        public int? ConvertedToSalesOrderId { get; set; }

        /// <summary>
        /// Copy lineage (2026-08-28): the document this row was created from via
        /// the Copy Document action, as a (type, id) pair —
        /// <see cref="Helpers.DocumentCopyTypes"/> holds the allowed type values.
        /// Deliberately NOT a foreign key: the source may be a different entity
        /// (a Purchase Bill copied into a Goods Receipt), so no single navigation
        /// fits, and deleting the source must never cascade into the copy. Null
        /// on documents that were not created by a copy.
        /// </summary>
        public string? CopiedFromType { get; set; }
        public int? CopiedFromId { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public Client Client { get; set; } = null!;
        public Division? Division { get; set; }
        public SalesOrder? ConvertedToSalesOrder { get; set; }
        public ICollection<SalesQuoteItem> Items { get; set; } = new List<SalesQuoteItem>();
    }
}
