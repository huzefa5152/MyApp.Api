namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Division-scope authorization — the layer below <see cref="ICompanyAccessGuard"/>.
    /// The company guard answers "can this user see THIS company?"; this one
    /// answers "within that company, can they see THIS division's records?".
    ///
    /// Semantics (see DIVISION_RBAC_AUDIT_2026_07_04.md §3.1):
    /// - A user is <b>unrestricted</b> in a company unless their UserCompany
    ///   row has <c>RestrictToDivisions = true</c>. Unrestricted = sees every
    ///   division; this is the default, so existing users are unaffected.
    /// - A <b>restricted</b> user sees only divisions granted via UserDivision
    ///   rows, plus company-level records (DivisionId == null) — policy D1.
    /// - Restricted users may NOT create/move records to company level
    ///   (policy D2) — use <see cref="AssertWriteAccessAsync"/> on write paths.
    /// - Seed admin bypasses everything, mirroring the other guards.
    ///
    /// Callers must run the company guard first; this guard assumes company
    /// access was already established and only refines it.
    /// </summary>
    public interface IDivisionAccessGuard
    {
        /// <summary>
        /// The user's division restrictions, keyed by company id. Companies
        /// where the user is unrestricted are absent. Cached (60s sliding,
        /// generation-invalidated) — this is the single source the other
        /// methods and /permissions/me derive from.
        /// </summary>
        Task<Dictionary<int, HashSet<int>>> GetRestrictionsAsync(int userId);

        /// <summary>
        /// Accessible division ids within one company, or <c>null</c> when the
        /// user is unrestricted there (callers skip filtering on null).
        /// </summary>
        Task<HashSet<int>?> GetAccessibleDivisionIdsAsync(int userId, int companyId);

        /// <summary>
        /// True when the user may READ a record carrying this division tag.
        /// A null divisionId (company-level record) is readable by anyone
        /// with company access — policy D1.
        /// </summary>
        Task<bool> HasAccessAsync(int userId, int companyId, int? divisionId);

        /// <summary>
        /// Read-path assert: throws <see cref="UnauthorizedAccessException"/>
        /// (→ 403 via the global middleware) when <see cref="HasAccessAsync"/>
        /// is false.
        /// </summary>
        Task AssertAccessAsync(int userId, int companyId, int? divisionId);

        /// <summary>
        /// Write-path assert: like <see cref="AssertAccessAsync"/>, but a
        /// restricted user is ALSO rejected when divisionId is null — they
        /// must tag writes with one of their granted divisions (policy D2),
        /// otherwise creating "company-level" records would bypass the
        /// restriction entirely.
        /// </summary>
        Task AssertWriteAccessAsync(int userId, int companyId, int? divisionId);

        /// <summary>Drop one user's cached restrictions — call after writing
        /// UserDivision rows or the RestrictToDivisions flag.</summary>
        void InvalidateUser(int userId);

        /// <summary>Drop every user's cached restrictions.</summary>
        void InvalidateAll();
    }
}
