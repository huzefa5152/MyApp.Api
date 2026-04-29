using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Single place where "make sure this unit name lives in the Units table"
    /// is enforced. Called from every save path that lets an operator type
    /// a unit string (challan create / edit / import, bill update, item-type
    /// save). The point is so the Units admin screen always reflects every
    /// UOM in use across the system — operators can then flip the
    /// AllowsDecimalQuantity flag for any of them.
    ///
    /// Strict idempotency contract:
    ///   • Existing name (case-insensitive — Units.Name is UNIQUE under SQL
    ///     Server's default CI collation): do nothing, do not throw.
    ///   • New name: insert a default integer-only row.
    ///   • Race: if a concurrent insert wins, swallow the
    ///     DbUpdateException and return cleanly so the caller's save
    ///     still succeeds.
    /// </summary>
    public static class UnitRegistry
    {
        /// <summary>
        /// Ensure each non-empty name appears in the Units table. Returns
        /// the number of rows inserted (0 when every name already existed).
        /// </summary>
        public static async Task<int> EnsureNamesAsync(AppDbContext db, IEnumerable<string?> names)
        {
            var distinct = (names ?? Enumerable.Empty<string?>())
                .Select(n => (n ?? "").Trim())
                .Where(n => n.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (distinct.Count == 0) return 0;

            // Batch-fetch which names already exist — one round-trip instead
            // of one-per-name. CI collation handles "kg" vs "KG" equality.
            var existing = await db.Units
                .Where(u => distinct.Contains(u.Name))
                .Select(u => u.Name)
                .ToListAsync();
            var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

            var toInsert = distinct
                .Where(n => !existingSet.Contains(n))
                .Select(n => new Unit { Name = n, AllowsDecimalQuantity = false })
                .ToList();
            if (toInsert.Count == 0) return 0;

            db.Units.AddRange(toInsert);
            try
            {
                await db.SaveChangesAsync();
                return toInsert.Count;
            }
            catch (DbUpdateException)
            {
                // Concurrent insert(s) won the race for one or more names.
                // Detach the failed entities so subsequent SaveChanges()
                // calls in this DbContext don't retry them, then fall back
                // to per-row inserts so the survivors still land.
                foreach (var u in toInsert)
                    db.Entry(u).State = EntityState.Detached;

                int landed = 0;
                foreach (var u in toInsert)
                {
                    if (await db.Units.AnyAsync(x => x.Name == u.Name)) continue;
                    db.Units.Add(u);
                    try
                    {
                        await db.SaveChangesAsync();
                        landed++;
                    }
                    catch (DbUpdateException)
                    {
                        db.Entry(u).State = EntityState.Detached;
                    }
                }
                return landed;
            }
        }
    }
}
