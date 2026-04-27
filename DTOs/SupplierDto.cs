namespace MyApp.Api.DTOs
{
    public class SupplierDto
    {
        public int? Id { get; set; }
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

        /// <summary>
        /// True when this supplier has at least one PurchaseBill against
        /// them. UI uses it to disable the Delete button — same UX as the
        /// Clients page, where deleting a client with invoices is gated.
        /// </summary>
        public bool HasPurchaseBills { get; set; }

        public DateTime? CreatedAt { get; set; }
    }
}
