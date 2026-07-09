namespace MyApp.Api.Models
{
    /// <summary>
    /// A division / department / sub-brand within a company (e.g. "Aliasghar",
    /// "AMS"). A company can have many. A division is treated as a "sub-company":
    /// it carries its own branding / contact details (logo, brand name, address,
    /// phone, NTN/CNIC/STRN) so documents tagged with a division can print with
    /// the division's identity instead of the parent company's, and it has its
    /// own Sales Quote numbering sequence. Managed from the Configuration →
    /// Divisions page. Names are unique per company (see AppDbContext index).
    /// </summary>
    public class Division
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";

        // ── Sub-company "Personal Details" (mirror of the Company fields). ──
        // All nullable/additive so existing divisions keep working with just a
        // Name until an operator fills these in.
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public string? Email { get; set; }

        // ── Per-division document numbering ──
        // When a document is tagged with this division, its number is allocated
        // from this division's own sequence (Starting* seeds the first; Current*
        // tracks the last issued). Company-level documents (no division) keep
        // using the Company counters. Default 0 → the first division document
        // seeds from 1 (or the division's Starting* when set).
        public int StartingSalesQuoteNumber { get; set; }
        public int CurrentSalesQuoteNumber { get; set; }
        public int StartingSalesOrderNumber { get; set; }
        public int CurrentSalesOrderNumber { get; set; }
        public int StartingChallanNumber { get; set; }
        public int CurrentChallanNumber { get; set; }
        public int StartingInvoiceNumber { get; set; }
        public int CurrentInvoiceNumber { get; set; }
        public int StartingPurchaseBillNumber { get; set; }
        public int CurrentPurchaseBillNumber { get; set; }
        public int StartingGoodsReceiptNumber { get; set; }
        public int CurrentGoodsReceiptNumber { get; set; }
        // Credit/Debit Notes: a note inherits its ORIGINAL invoice's division
        // and numbers from that division's own note sequence (Credit Note #1,
        // Debit Note #1 per division), mirroring the invoice pattern above.
        public int StartingCreditNoteNumber { get; set; }
        public int CurrentCreditNoteNumber { get; set; }
        public int StartingDebitNoteNumber { get; set; }
        public int CurrentDebitNoteNumber { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
