using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Per-division document numbering (design: mirror the SalesQuote pattern).
    /// When a document is tagged with a division it draws from THAT division's
    /// own sequence (seeded by the division's Starting* number); otherwise it
    /// uses the company's. The unique index is scoped by (CompanyId, DivisionId,
    /// Number) so the two scopes never collide. Callers run this inside their
    /// existing NumberAllocationRetry loop and persist the returned number.
    /// </summary>
    public static class DivisionNumbering
    {
        /// <summary>Validate that a division belongs to the company (throws if not).
        /// Returns the tracked Division, or null when divisionId is null.</summary>
        public static async Task<Division?> ResolveAsync(AppDbContext db, int companyId, int? divisionId)
        {
            if (!divisionId.HasValue) return null;
            var div = await db.Divisions.FirstOrDefaultAsync(d => d.Id == divisionId.Value && d.CompanyId == companyId);
            if (div == null) throw new InvalidOperationException("Division does not belong to this company.");
            return div;
        }

        /// <summary>Compute the next number for a (company, division) scope given the
        /// current max in that scope and the relevant Starting* seed.</summary>
        public static int Next(int maxInScope, int seedStarting) =>
            System.Math.Max(maxInScope + 1, seedStarting > 0 ? seedStarting : 1);
    }
}
