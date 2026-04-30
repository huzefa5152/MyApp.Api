namespace MyApp.Api.DTOs
{
    public class ClientDto
    {
        public int? Id { get; set; }           // Nullable for new clients
        public string Name { get; set; } = null!;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? Site { get; set; }
        public string? RegistrationType { get; set; }
        public string? CNIC { get; set; }
        public int? FbrProvinceCode { get; set; }
        public int CompanyId { get; set; }

        // Common Client grouping id (read-only on this DTO). Lets the
        // per-company list surface "this client is also in N other
        // companies" affordances and links to the Common Client edit
        // view. Nullable until the backfill / EnsureGroup runs.
        public int? ClientGroupId { get; set; }

        public bool HasInvoices { get; set; }
        public DateTime? CreatedAt { get; set; } // Nullable; set by server
    }
}
