using System.Security.Claims;
using MyApp.Api.DTOs;

namespace MyApp.Api.Services.Interfaces
{
    /// <summary>
    /// Aggregates the home-page KPIs in a single call. Permission-shaped
    /// — sections are populated only when the caller holds the matching
    /// dashboard.kpi.*.view perm. The "all-time" period is supported
    /// (from = null, to = null).
    /// </summary>
    public interface IDashboardService
    {
        Task<DashboardKpisResponse> GetKpisAsync(
            int companyId,
            string periodCode,
            DateTime? from,
            DateTime? to,
            ClaimsPrincipal user);

        /// <summary>
        /// The rows behind one KPI, totalling to exactly what that card shows.
        /// Computed from the same source the card is, so the two cannot drift.
        /// </summary>
        Task<DashboardBreakdownDto> GetBreakdownAsync(
            int companyId, string kind, string periodCode, DateTime? from, DateTime? to,
            string? groupKey, ClaimsPrincipal user);

        /// <summary>
        /// The Payable to FBR panel, over whole months covering the period.
        /// Refusal is set (and Dto null) when the caller lacks
        /// dashboard.kpi.sales.view or is division-restricted.
        /// </summary>
        Task<(DashboardTaxPositionDto? Dto, string? Refusal)> GetTaxPositionAsync(
            int companyId, string periodCode, DateTime? from, DateTime? to, ClaimsPrincipal user);
    }
}
