namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Resolves whether a given user is granted a given permission key.
    /// Results are cached in-process for a short TTL; cache is invalidated
    /// when a user's role assignments or a role's permissions change.
    /// </summary>
    public interface IPermissionService
    {
        /// <summary>True if the user has the permission. Seed admin short-circuits to true for every key.</summary>
        Task<bool> HasPermissionAsync(int userId, string permissionKey);

        /// <summary>Returns every permission key granted to the user via their assigned roles (seed admin returns the full catalog).</summary>
        Task<IReadOnlyCollection<string>> GetUserPermissionsAsync(int userId);

        /// <summary>Drop the cached permission set for a specific user — call after their role assignments change.</summary>
        void InvalidateUser(int userId);

        /// <summary>Drop every cached permission set — call after a role's permission list changes (affects many users).</summary>
        void InvalidateAll();

        /// <summary>True when the given userId is the configured seed-admin user.</summary>
        bool IsSeedAdmin(int userId);
    }
}
