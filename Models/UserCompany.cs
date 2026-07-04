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

        /// <summary>
        /// When true, this user's view of the company is limited to the
        /// divisions granted in <see cref="UserDivision"/> rows (plus
        /// company-level records with no division). Default false = full
        /// company access, today's behaviour — so no backfill is needed and
        /// deleting a user's last UserDivision row can never silently widen
        /// access. Enforced by <c>IDivisionAccessGuard</c>.
        /// </summary>
        public bool RestrictToDivisions { get; set; }
    }
}
