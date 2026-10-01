using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyApp.Api.Data;
using MyApp.Api.Services.Interfaces;

namespace MyApp.Api.Services.Implementations
{
    /// <summary>
    /// See <see cref="ICompanyAccessGuard"/>. Grants are cached only within
    /// a request, so another process cannot keep a revoked grant alive.
    /// </summary>
    public class CompanyAccessGuard : ICompanyAccessGuard
    {
        private const string CachePrefix = "company-access:user:";

        private readonly AppDbContext _context;
        private readonly int _seedAdminUserId;
        private readonly IHttpContextAccessor _http;

        public CompanyAccessGuard(AppDbContext context, IMemoryCache cache, IConfiguration configuration,
            IHttpContextAccessor http)
        {
            _context = context;
            _http = http;
            _seedAdminUserId = configuration.GetValue<int>("AppSettings:SeedAdminUserId", 1);
        }

        public async Task<bool> HasAccessAsync(int userId, int companyId)
        {
            if (userId <= 0 || companyId <= 0) return false;
            if (userId == _seedAdminUserId) return true;
            // Reuse the request's explicit assignment set. Company flags and
            // administrative RBAC roles never grant a tenant-wide bypass.
            var accessible = await GetAccessibleCompanyIdsAsync(userId);
            return accessible.Contains(companyId);
        }

        public async Task AssertAccessAsync(int userId, int companyId)
        {
            if (!await HasAccessAsync(userId, companyId))
            {
                throw new UnauthorizedAccessException(
                    $"You do not have access to company {companyId}.");
            }
            if (_http.HttpContext is { } context)
                context.Items["currentCompanyId"] = companyId;
        }

        public async Task<HashSet<int>> GetAccessibleCompanyIdsAsync(int userId)
        {
            if (userId <= 0) return new HashSet<int>();
            if (userId == _seedAdminUserId)
            {
                return await _context.Companies.Select(c => c.Id).ToHashSetAsync();
            }

            var cacheKey = $"{CachePrefix}{userId}";
            if (_http.HttpContext?.Items[cacheKey] is HashSet<int> cached)
                return cached;

            // Fail-closed rule: a non-admin user sees ONLY the companies
            // listed in UserCompanies. No rows = no access.
            //
            // Existing users created before the Tenant Access UI shipped
            // are seeded one row per open company by the one-time backfill
            // in Program.cs (RBAC_USERCOMPANIES_BACKFILL_V1) so they don't
            // go dark on the upgrade. New users (post-backfill) start with
            // zero rows and see nothing until an operator explicitly
            // assigns them via Configuration → Tenant Access.
            //
            // The IsTenantIsolated flag on Company is now informational —
            // it was meaningful under the previous "open mode falls
            // through" semantics; under fail-closed it doesn't change
            // access decisions. Kept in the schema to preserve operator
            // intent and to drive the backfill (only OPEN companies are
            // auto-granted to existing users).
            var explicitGrants = await _context.UserCompanies
                .Where(uc => uc.UserId == userId)
                .Select(uc => uc.CompanyId)
                .ToListAsync();
            var set = new HashSet<int>(explicitGrants);

            if (_http.HttpContext is { } http) http.Items[cacheKey] = set;
            return set;
        }

        public void InvalidateUser(int userId)
        {
            _http.HttpContext?.Items.Remove($"{CachePrefix}{userId}");
        }

        public void InvalidateAll()
        {
            if (_http.HttpContext is not { } http) return;
            foreach (var key in http.Items.Keys.OfType<string>().Where(k => k.StartsWith(CachePrefix)).ToArray())
                http.Items.Remove(key);
        }
    }
}
