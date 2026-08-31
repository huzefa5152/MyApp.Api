using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Single place where "make sure this item name lives in the
    /// ItemDescriptions table" is enforced. Called from every save path that
    /// lets an operator type a free-text item name (bill create — both the
    /// challan-linked and standalone paths — plus challan create / edit /
    /// import), so the bill form's SmartItemAutocomplete always offers every
    /// name actually in use.
    ///
    /// Sibling of <see cref="UnitRegistry"/> and deliberately the same shape.
    ///
    /// Strict idempotency contract:
    ///   • Existing name: do nothing, do not throw. "Existing" has to mean what
    ///     SQL Server means by it — ItemDescriptions.Name is UNIQUE under the
    ///     default CI collation with ANSI PadSpace, so "Steel Pipe",
    ///     "STEEL PIPE" and "STEEL PIPE " are all the SAME key. An in-memory
    ///     check that disagrees with the index inserts a row the index then
    ///     rejects.
    ///   • New name: insert it, preserving the operator's own casing.
    ///   • Existing rows are never modified — they carry saved FBR defaults
    ///     (HS code, sale type, UOM) that must not be clobbered.
    ///   • Race: a concurrent insert wins → swallow, fall back to per-row
    ///     inserts so the genuinely-new names still land, and return cleanly.
    ///
    /// Never throwing matters more here than it looks. Both bill-create paths
    /// call this INSIDE the invoice transaction, a few lines above a
    ///     catch (DbUpdateException) when (NumberAllocationRetry.IsUniqueViolation(ex))
    /// handler. That predicate matches SQL 2601/2627 from ANY unique index, so a
    /// duplicate key on ItemDescriptions.Name was indistinguishable from an
    /// invoice-number collision: the create rolled back and retried the number
    /// allocation, hit the same deterministic casing clash on every attempt, and
    /// the operator was told "Could not allocate a unique invoice number after N
    /// attempts" for a problem that had nothing to do with numbering. Keeping
    /// the duplicate inside this helper is what stops that misdiagnosis.
    /// </summary>
    public static class ItemDescriptionRegistry
    {
        /// <summary>
        /// Ensure each non-empty name appears in ItemDescriptions. Returns the
        /// number of rows inserted (0 when every name already existed).
        /// </summary>
        public static async Task<int> EnsureNamesAsync(AppDbContext db, IEnumerable<string?> names)
        {
            var distinct = (names ?? Enumerable.Empty<string?>())
                .Select(n => (n ?? "").Trim())
                .Where(n => n.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (distinct.Count == 0) return 0;

            // Batch-fetch which names already exist — one round-trip instead of
            // one-per-name, and the CI collation resolves a typed "Steel Pipe"
            // against a stored "STEEL PIPE".
            //
            // Trim the RESULT too. SQL Server compares (n)varchar with ANSI
            // PadSpace, so 'X' = 'X ' is TRUE and the unique index treats them as
            // one key — but a stored "X " comes back un-trimmed, and a
            // space-sensitive HashSet would miss it, so we would try to insert
            // "X" and the index would reject it. Discovered 2026-05-25 on challan
            // #1101, where the row for "WATER POSTER MARKING COLOUR 500ML" was
            // stored with a trailing space and silently blocked every edit
            // through that path.
            var existing = (await db.ItemDescriptions
                .Where(i => distinct.Contains(i.Name))
                .Select(i => i.Name)
                .ToListAsync())
                .Select(n => (n ?? "").Trim());
            var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);

            var toInsert = distinct
                .Where(n => !existingSet.Contains(n))
                .Select(n => new ItemDescription { Name = n })
                .ToList();
            if (toInsert.Count == 0) return 0;

            db.ItemDescriptions.AddRange(toInsert);
            try
            {
                await db.SaveChangesAsync();
                return toInsert.Count;
            }
            catch (DbUpdateException)
            {
                // Lost the race with a concurrent insert, OR CI/PadSpace equality
                // matched a row the in-memory check didn't. Same recovery pattern
                // UnitRegistry.EnsureNamesAsync uses: detach the batch so later
                // SaveChanges() calls on this context don't retry it, then insert
                // row-by-row so the survivors still land. Catalog staleness is
                // recoverable; failing the caller's save is not.
                foreach (var d in toInsert)
                    db.Entry(d).State = EntityState.Detached;

                int landed = 0;
                foreach (var d in toInsert)
                {
                    if (await db.ItemDescriptions.AnyAsync(x => x.Name == d.Name)) continue;
                    db.ItemDescriptions.Add(d);
                    try
                    {
                        await db.SaveChangesAsync();
                        landed++;
                    }
                    catch (DbUpdateException)
                    {
                        db.Entry(d).State = EntityState.Detached;
                    }
                }
                return landed;
            }
        }
    }
}
