namespace MyApp.Api.DTOs
{
    /// <summary>Wire shape for a company division ("sub-company"). Used for
    /// read + create/update (Id ignored on create; CompanyId comes from the
    /// route). Carries the division's own branding/contact details and its
    /// Sales Quote starting number. LogoPath is read-only here — it is set
    /// via the dedicated POST /divisions/{id}/logo upload endpoint.</summary>
    public class DivisionDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string Name { get; set; } = "";

        // Sub-company "Personal Details"
        public string? BrandName { get; set; }
        public string? LogoPath { get; set; }
        public string? FullAddress { get; set; }
        public string? Phone { get; set; }
        public string? NTN { get; set; }
        public string? CNIC { get; set; }
        public string? STRN { get; set; }
        public string? Email { get; set; }

        // Per-division Sales Quote numbering. CurrentSalesQuoteNumber is
        // read-only (advanced by the create flow); StartingSalesQuoteNumber is
        // operator-editable to seed the sequence.
        public int StartingSalesQuoteNumber { get; set; }
        public int CurrentSalesQuoteNumber { get; set; }
    }
}
