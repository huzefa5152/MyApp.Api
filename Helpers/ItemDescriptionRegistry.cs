using Microsoft.EntityFrameworkCore;
using MyApp.Api.Data;
using MyApp.Api.Models;

namespace MyApp.Api.Helpers
{
    /// <summary>
    /// Upserts item names into the generic <see cref="ItemDescription"/> catalog
    /// so every document type feeds the same autocomplete/suggestion source.
    /// Sales Quote and Sales Order lines call this on save so their descriptions
    /// become reusable everywhere (bills, challans, …) — mirroring the behaviour
    /// DeliveryChallanService already has for challan lines. Best-effort and
    /// race-safe: never let a catalog-staleness hiccup crash the caller's save.
    /// </summary>
    public static class ItemDescriptionRegistry
    {
        public static async Task EnsureAsync(AppDbContext context, IEnumerable<string?> descriptions)
        {
            var names = descriptions
                .Select(d => d?.Trim() ?? "")
                .Where(d => !string.IsNullOrWhiteSpace(d))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (names.Count == 0) return;

            // Trim the projection result. SQL Server uses ANSI PadSpace
            // semantics on (n)varchar, so 'X' = 'X ' is TRUE and the unique
            // index on ItemDescriptions.Name treats them as the same key.
            // Without the Trim() here, a stored "X " comes back un-trimmed,
            // the HashSet (Ordinal+IgnoreCase but space-sensitive) misses the
            // candidate "X", we try to INSERT "X", and SQL Server fires a
            // duplicate-key violation against the padded row. (Same fix
            // DeliveryChallanService.EnsureItemDescriptionsAsync carries.)
            var existing = (await context.ItemDescriptions
                .Where(it => names.Contains(it.Name))
                .Select(it => it.Name)
                .ToListAsync())
                .Select(n => (n ?? "").Trim());
            var existingSet = new HashSet<string>(existing, StringComparer.OrdinalIgnoreCase);
            var toAdd = names.Where(n => !existingSet.Contains(n))
                             .Select(n => new ItemDescription { Name = n })
                             .ToList();
            if (toAdd.Count == 0) return;

            context.ItemDescriptions.AddRange(toAdd);
            try
            {
                await context.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // Lost the race with a concurrent insert OR PadSpace equality
                // matched a row our in-memory check didn't. Detach the batch,
                // fall back to per-row inserts so genuinely-new names still land.
                foreach (var d in toAdd)
                    context.Entry(d).State = EntityState.Detached;

                foreach (var d in toAdd)
                {
                    if (await context.ItemDescriptions.AnyAsync(x => x.Name == d.Name)) continue;
                    context.ItemDescriptions.Add(d);
                    try
                    {
                        await context.SaveChangesAsync();
                    }
                    catch (DbUpdateException)
                    {
                        context.Entry(d).State = EntityState.Detached;
                    }
                }
            }
        }
    }
}
