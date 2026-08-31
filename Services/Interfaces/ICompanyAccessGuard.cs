namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Tenant-scope authorization. RBAC answers "can this user view
    /// suppliers?" — this answers "can this user view THIS company's
    /// suppliers?". Used by the <c>[AuthorizeCompany]</c> filter on every
    /// endpoint that takes a <c>companyId</c> from the route, query, or
    /// body.
    ///
    /// The rule is fail-closed: apart from the seed admin, a user reaches only
    /// the companies listed for them in <c>UserCompanies</c>. See
    /// <see cref="HasAccessAsync"/> for why <c>Company.IsTenantIsolated</c> does
    /// not enter into it.
    /// </summary>
    public interface ICompanyAccessGuard
    {
        /// <summary>
        /// True if the user may access the given company.
        ///
        /// Fail-closed: the seed admin passes for every company, and everyone
        /// else needs an explicit <c>UserCompany</c> row. No rows means no
        /// access — there is no fallback that grants a company to any
        /// authenticated user.
        ///
        /// <c>Company.IsTenantIsolated</c> does NOT affect this decision. It is
        /// informational only: it records operator intent and selects which
        /// companies the one-time backfill auto-granted to users who existed
        /// before the Tenant Access UI shipped
        /// (<c>RBAC_USERCOMPANIES_BACKFILL_V1</c> in <c>Program.cs</c>). A user
        /// created after that backfill sees nothing until an operator assigns
        /// them companies under Configuration → Tenant Access, even for a
        /// company with <c>IsTenantIsolated=false</c>.
        /// </summary>
        Task<bool> HasAccessAsync(int userId, int companyId);

        /// <summary>
        /// Throws <see cref="UnauthorizedAccessException"/> when the user
        /// has no access — mapped to HTTP 403 by the filter / global
        /// exception middleware.
        /// </summary>
        Task AssertAccessAsync(int userId, int companyId);

        /// <summary>
        /// Returns the set of company ids the user may see. Used by
        /// list-everything endpoints to filter rather than 403.
        /// </summary>
        Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int userId);

        /// <summary>
        /// Drop the cached accessible-company set for one user. Call
        /// after writing UserCompanies rows so the next request reflects
        /// the change without waiting for the 60s TTL.
        /// </summary>
        void InvalidateUser(int userId);

        /// <summary>
        /// Drop every cached accessible-company set at once. Use it for a change
        /// that could affect many users, such as deleting a company.
        ///
        /// Callers should NOT rely on this to react to an
        /// <c>IsTenantIsolated</c> flip: under the fail-closed rule that flag no
        /// longer changes anyone's access, so nothing needs re-evaluating.
        /// </summary>
        void InvalidateAll();
    }
}
