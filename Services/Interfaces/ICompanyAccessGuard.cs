namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Tenant-scope authorization. RBAC answers "can this user view
    /// suppliers?" — this answers "can this user view THIS company's
    /// suppliers?". Used by the <c>[AuthorizeCompany]</c> filter on every
    /// endpoint that takes a <c>companyId</c> from the route, query, or
    /// body.
    /// </summary>
    public interface ICompanyAccessGuard
    {
        /// <summary>
        /// True if the user may access the given company. Seed admin
        /// always passes. Every other user requires an explicit
        /// <c>UserCompany</c> row, independent of IsTenantIsolated.
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
        /// after writing UserCompanies rows. No cache survives the request.
        /// </summary>
        void InvalidateUser(int userId);

        /// <summary>
        /// Drop every cached accessible-company set. Call when a company
        /// is deleted or assignments change within this request.
        /// </summary>
        void InvalidateAll();
    }
}
