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

        // ── Per-division Sales Quote numbering ──
        // When a sales quote is tagged with this division, its QuoteNumber is
        // allocated from this division's own sequence (StartingSalesQuoteNumber
        // seeds the first; CurrentSalesQuoteNumber tracks the last issued).
        // Company-level quotes (no division) keep using the Company counters.
        // Default 0 → the first division quote seeds from 1. Other document
        // numbers (order / challan / invoice) stay company-level for now.
        public int StartingSalesQuoteNumber { get; set; }
        public int CurrentSalesQuoteNumber { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public Company Company { get; set; } = null!;
    }
}
