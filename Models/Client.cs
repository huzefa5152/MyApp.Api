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

        // Common Client grouping. Nullable for backward compatibility:
        // existing rows are NULL until the one-time backfill assigns them
        // a group. New / updated clients are assigned a group via
        // ClientGroupService.EnsureGroupForClientAsync — same NTN (or same
        // normalised name when NTN is missing) ⇒ same group. Single-company
        // clients still get a group so the link is automatic the moment a
        // 2nd company adds the same client.
        public int? ClientGroupId { get; set; }
        public ClientGroup? ClientGroup { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        // Navigation
        public Company Company { get; set; } = null!;
        public ICollection<DeliveryChallan> DeliveryChallans { get; set; } = new List<DeliveryChallan>();
    }
}
