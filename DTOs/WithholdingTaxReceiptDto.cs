namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Wire shape for a Withholding Tax Receipt — the customer-issued tax
    /// certificate. List + create/edit + view all use this one shape; the view
    /// screen reads the customer's address / NTN / STRN via the existing client
    /// endpoint and the company block from context, so no separate print DTO is
    /// needed.
    /// </summary>
    public class WithholdingTaxReceiptDto
    {
        public int Id { get; set; }
        public int ReceiptNumber { get; set; }
        public int CompanyId { get; set; }

        /// <summary>Optional division ("sub-company"); drives per-division numbering.</summary>
        public int? DivisionId { get; set; }
        public string? DivisionName { get; set; }

        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        public DateTime Date { get; set; }
        public decimal Amount { get; set; }
        public string? Description { get; set; }

        public DateTime CreatedAt { get; set; }

        /// <summary>True when this is the highest-numbered receipt for its
        /// (company, division) sequence — gates Delete so the number stays
        /// gap-free, mirroring the other sales documents.</summary>
        public bool IsLatest { get; set; }
    }
}
