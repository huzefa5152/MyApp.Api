namespace MyApp.Api.DTOs
{
    /// <summary>
    /// Management-side view of a portal. Carries the live
    /// <see cref="PublicUrl"/> because the whole point of the screen is to hand
    /// that link to an operator — which also means this DTO holds a bearer
    /// secret and must never be logged, audited, or returned from anything but
    /// the permission-gated management endpoints.
    /// </summary>
    public class CustomerPortalDto
    {
        public int Id { get; set; }
        public int CompanyId { get; set; }
        public string CompanyName { get; set; } = "";
        public int ClientId { get; set; }
        public string ClientName { get; set; } = "";

        /// <summary>The full link to give the customer, built server-side.</summary>
        public string PublicUrl { get; set; } = "";

        public bool IsActive { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? DisabledAt { get; set; }
    }

    public class CreateCustomerPortalDto
    {
        public int CompanyId { get; set; }
        public int ClientId { get; set; }
    }

    /// <summary>Body for the enable/disable toggle.</summary>
    public class SetCustomerPortalActiveDto
    {
        public bool IsActive { get; set; }
    }
}
