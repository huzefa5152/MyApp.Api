namespace MyApp.Api.Models
{
    /// <summary>
    /// Explicit grant: this user may access this company's data. Used by
    /// <c>ICompanyAccessGuard</c> to enforce tenant isolation when
    /// <see cref="Company.IsTenantIsolated"/> is true. Companies with that
    /// flag false stay open to any authenticated user with the right
    /// permission (preserves Hakimi/Roshan behaviour); SaaS tenants flip
    /// the flag and operate via these rows.
    /// </summary>
    public class UserCompany
    {
        public int UserId { get; set; }
        public User? User { get; set; }

        public int CompanyId { get; set; }
        public Company? Company { get; set; }

        public DateTime AssignedAt { get; set; } = DateTime.UtcNow;
        public int? AssignedByUserId { get; set; }
    }
}
