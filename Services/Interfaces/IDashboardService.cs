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
            ClaimsPrincipal user);
    }
}
