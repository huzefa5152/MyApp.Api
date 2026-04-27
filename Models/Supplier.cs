namespace MyApp.Api.Models
{
    /// <summary>
    /// Mirror of <see cref="Client"/> for the purchase side. Represents an
    /// entity that sells TO this Company. Scoped per-Company so each tenant
    /// keeps its own supplier list (no cross-tenant visibility).
    ///
    /// Same fields as Client because a real-world party can be either: NTN /
    /// STRN / address / FBR registration type are needed for the same
    /// reasons (input-tax claim validity, tax-invoice formatting, STATL
    /// pre-check before booking a purchase).
    /// </summary>
    public class Supplier
    {
        public int Id { get; set; }
        public string Name { get; set; } = null!;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? Site { get; set; }

        // FBR Digital Invoicing — same shape as Client.
        public string? RegistrationType { get; set; }
        public string? CNIC { get; set; }
        public int? FbrProvinceCode { get; set; }

        public int CompanyId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<PurchaseBill> PurchaseBills { get; set; } = new List<PurchaseBill>();
        public ICollection<GoodsReceipt> GoodsReceipts { get; set; } = new List<GoodsReceipt>();
    }
}
