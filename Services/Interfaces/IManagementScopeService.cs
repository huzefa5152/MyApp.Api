namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Hierarchical management scope (2026-09-11). RBAC answers "may this
    /// user edit users at all?"; <see cref="ICompanyAccessGuard"/> answers
    /// "may this user touch THIS company's data?"; this service answers
    /// "which users and which grants is this user allowed to administer?".
    ///
    /// Model: exactly one seed admin (AppSettings:SeedAdminUserId) sits at
    /// the root and manages everyone. Every other account carries
    /// <c>User.CreatedByUserId</c>; an Administrator manages precisely the
    /// accounts beneath it in that chain (children, grandchildren, …) and
    /// nothing else — not the seed admin, not sibling Administrators, not
    /// their trees. Root-level accounts (CreatedByUserId NULL) are managed
    /// by the seed admin only.
    ///
    /// Company scope for administration rides on the existing
    /// UserCompanies grants: an Administrator may hand out only the
    /// companies it currently holds itself, so revoking a grant from the
    /// Administrator also stops it re-granting that company downstream.
    /// </summary>
    public interface IManagementScopeService
    {
        /// <summary>True when the id is the configured seed admin.</summary>
        bool IsSeedAdmin(int userId);

        /// <summary>
        /// Ids of every user the caller may administer. Seed admin: every
        /// user (itself included). Anyone else: its descendants via the
        /// CreatedByUserId chain — never itself, never the seed admin.
        /// </summary>
        Task<HashSet<int>> GetManageableUserIdsAsync(int userId);

        /// <summary>
        /// Ids the caller may see in user lists: manageable set plus the
        /// caller's own row.
        /// </summary>
        Task<HashSet<int>> GetVisibleUserIdsAsync(int userId);

        /// <summary>True when <paramref name="actorUserId"/> may read or
        /// change <paramref name="targetUserId"/>. Seed admin: always.
        /// Otherwise the target must be a descendant. The existing
        /// seed-admin protections (cannot edit / delete the seed) remain
        /// the controllers' job.</summary>
        Task<bool> CanManageUserAsync(int actorUserId, int targetUserId);

        /// <summary>
        /// Companies the caller may grant to or revoke from the users it
        /// manages. Seed admin: every company. Otherwise the caller's own
        /// accessible set (<see cref="ICompanyAccessGuard.GetAccessibleCompanyIdsAsync"/>).
        /// </summary>
        Task<HashSet<int>> GetAssignableCompanyIdsAsync(int userId);

        /// <summary>
        /// Ancestors of a user via CreatedByUserId, nearest first, seed
        /// admin excluded. Used to grant a newly created company up the
        /// chain so whoever manages the creator can see what they made.
        /// </summary>
        Task<List<int>> GetAncestorUserIdsAsync(int userId);

        /// <summary>Drop every cached scope — call after a user is created,
        /// deleted or re-parented.</summary>
        void InvalidateAll();
    }
}
