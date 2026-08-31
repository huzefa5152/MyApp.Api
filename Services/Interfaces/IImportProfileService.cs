using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// CRUD and version history for saved workbook layouts
    /// (<see cref="Models.ImportProfile"/>).
    ///
    /// Visibility is the part worth reading twice: a profile with a CompanyId is
    /// private to that tenant, and one without is installation-wide reference
    /// data every company can use. The service never decides who the caller is —
    /// it takes the caller's accessible company set and seed-admin flag from the
    /// controller, so the tenant rule stays in one place and cannot be bypassed
    /// by a body field.
    /// </summary>
    public interface IImportProfileService
    {
        /// <summary>
        /// Profiles the caller may see: installation-wide ones, plus private
        /// ones belonging to a company in <paramref name="accessibleCompanyIds"/>.
        /// </summary>
        Task<List<ImportProfileDto>> ListAsync(
            string? kind, int? companyId, IReadOnlyCollection<int> accessibleCompanyIds);

        /// <summary>One profile, or null when it does not exist. The caller is
        /// responsible for the visibility check — see
        /// <see cref="CanAccessAsync"/>.</summary>
        Task<ImportProfileDto?> GetAsync(int id);

        /// <summary>
        /// True when a caller holding <paramref name="accessibleCompanyIds"/> may
        /// read this profile. Kept here rather than in the controller so the
        /// "shared or mine" rule has exactly one implementation.
        /// </summary>
        Task<bool> CanAccessAsync(int id, IReadOnlyCollection<int> accessibleCompanyIds);

        /// <summary>Owning company of a profile, and whether it exists.
        /// (found, companyId) — companyId null means installation-wide.</summary>
        Task<(bool Found, int? CompanyId)> GetOwnerAsync(int id);

        /// <summary>
        /// Saves a confirmed mapping as version 1. Throws
        /// <see cref="InvalidOperationException"/> when the kind, layout or
        /// mapping JSON is unusable — the controller turns that into a 400.
        /// </summary>
        Task<ImportProfileDto> CreateAsync(CreateImportProfileDto dto, string? userName);

        /// <summary>
        /// Applies only the fields present. A changed mapping or layout bumps
        /// <c>CurrentVersion</c> and appends history; a rename alone does not,
        /// because a version that changes no rule is noise in the audit trail.
        /// </summary>
        Task<ImportProfileDto?> UpdateAsync(int id, UpdateImportProfileDto dto, string? userName);

        Task<List<ImportProfileVersionDto>> GetVersionsAsync(int id);

        /// <summary>
        /// Restores an earlier mapping by copying it FORWARD as a new version,
        /// so the history stays append-only and the rollback itself is recorded.
        /// </summary>
        Task<ImportProfileDto?> RollbackAsync(int id, RollbackImportProfileDto dto, string? userName);

        Task<bool> DeleteAsync(int id);
    }
}
