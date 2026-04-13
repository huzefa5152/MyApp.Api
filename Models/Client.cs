namespace MyApp.Api.Models
{
    public class Client
    {
        public int Id { get; set; }
        public string Name { get; set; } = null!;
        public string? Address { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? NTN { get; set; }
        public string? STRN { get; set; }
        public string? Site { get; set; }

        // FBR Digital Invoicing
        public string? RegistrationType { get; set; }
        public string? CNIC { get; set; }
        public int? FbrProvinceCode { get; set; }

        public int CompanyId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
