using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Seeds a starter catalog of FBR-mapped item types covering the common
    /// categories sold by pneumatic / hardware / general-order-supply businesses.
    ///
    /// Runs once on startup: rows are only inserted if no existing item type
    /// already uses the same HS code (so re-seeding is safe + idempotent).
    /// Pre-existing user-created item types are left untouched.
    ///
    /// All codes were verified against FBR's live catalog
    /// (https://gw.fbr.gov.pk/pdi/v1/itemdesccode) AND against
    /// HsPrefixHeuristics — every entry below falls through to SN001
    /// "Goods at Standard Rate (default)" 18 %, no 3rd-Schedule / petroleum
    /// / steel-sector / drug / mobile-phone surprises.
    /// </summary>
    public static class ItemTypeSeeder
    {
        private record Seed(string Name, string HSCode, string UOM, int FbrUOMId, string SaleType, string FbrDescription);

        // ── Audit-log marker gating the one-time reseed cleanup ─────
        // When this marker is missing, CleanupAsync runs once (and writes
        // the marker on completion) so a v1 → v2 upgrade can drop the
        // pre-curation seed rows. Subsequent restarts skip cleanup.
        private const string ReseedMarkerKey = "ITEM_TYPE_RESEED_V2_18PCT_ONLY";

        // Names + HS codes that came from any earlier version of this
        // seeder (v1 had Soap, Detergent, Light Bulbs, Batteries, Face
        // Masks — items that PRAL classifies under 3rd Schedule, which
        // would silently fail FBR validation under the standard-rate
        // sale type the seeder gave them). We delete these only when
        // they are NOT in use by any DeliveryItem — preserving any
        // referential integrity the operator built up around them.
        private static readonly (string Name, string HSCode)[] LegacySeedRows = new[]
        {
            // Items present in v1 + v2 (kept under new names / cleaner data)
            ("Glue & Adhesives",      "3506.9110"),  // → renamed to "Industrial Adhesives"

            // Items removed in v2 because they're 3rd Schedule per FBR
            ("Soap",                  "3401.1910"),
            ("Detergent",             "3402.2000"),
            ("Light Bulbs",           "8539.2210"),

            // Items removed in v2 because they're commonly 3rd Schedule
            // for retail, and the seeder gave them a standard-rate label
            // that would mismatch on FBR submission for retail flows.
            ("Batteries",             "8506.1010"),
            ("Face Masks",            "6307.9090"),
        };

        // All entries below are industrial / B2B HS codes that reliably fall
        // under FBR's "Goods at Standard Rate (default)" — 18% — for SN001
        // (registered buyer) and SN002 (unregistered buyer) submissions.
        //
        // Items that frequently fall under 3rd Schedule (FMCG retail goods —
        // soap, detergent, light bulbs, dry-cell batteries, face masks) were
        // intentionally left out: they need SN008/SN027 with retail-price
        // tax-back-out math, which would produce silent FBR validation
        // failures if seeded under the standard-rate sale type. Operators
        // selling those should add them manually with the correct SaleType.
        private static readonly Seed[] Defaults = new[]
        {
            // ── Hardware / Pneumatic (core business — Section XV / XVI items, all 18% standard) ──
            // UoM choices below are anchored to FBR's HS_UOM master
            // (gw.fbr.gov.pk/pdi_data/v2/HS_UOM?annexure_id=3). FBR rejects
            // any UoM that isn't in the published list with error 0099, so
            // we mirror their picks exactly even when the convention feels
            // odd — e.g. "Bolts" billed by KG, "Rubber Hoses" billed by
            // pieces. FbrUOMId comes from the same master row.
            new Seed("Valves (all types)",        "8481.8090", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Ball, gate, check, globe, needle, solenoid valves"),
            new Seed("Pipe Fittings (Steel)",     "7307.9900", "KG",                     13, "Goods at Standard Rate (default)", "Elbows, tees, reducers, unions, nipples"),
            new Seed("Pneumatic Cylinders",       "8412.2900", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Pneumatic / hydraulic cylinders and actuators"),
            new Seed("Bolts, Nuts & Screws",      "7318.1590", "KG",                     13, "Goods at Standard Rate (default)", "All threaded hardware — bolts, nuts, screws, washers"),
            new Seed("Rubber Hoses & Fittings",   "4009.3130", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Pneumatic hoses, push-in fittings"),
            new Seed("Steel Pipes & Tubes",       "7304.9000", "KG",                     13, "Goods at Standard Rate (default)", "Iron/steel seamless tubes and pipes"),
            new Seed("Bearings",                  "8482.1090", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Ball bearings, roller bearings"),
            new Seed("Gaskets & Seals",           "8484.1010", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Gaskets and similar joints of metal sheeting"),

            // ── Office / industrial supplies (B2B wholesale — 18 %) ──
            new Seed("Pencils",                   "9609.2020", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Pencils, mechanical pencils"),
            new Seed("Pens & Markers",            "9608.9100", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Ball pens, felt-tipped markers, highlighters"),
            new Seed("Paper & Files",             "4820.1010", "Numbers, pieces, units", 69, "Goods at Standard Rate (default)", "Notebooks, registers, files, envelopes"),
            new Seed("Adhesive Tape",             "3919.1090", "KG",                     13, "Goods at Standard Rate (default)", "Self-adhesive tape, masking tape, scotch tape"),
            new Seed("Industrial Adhesives",      "3506.9110", "KG",                     13, "Goods at Standard Rate (default)", "Industrial epoxy / cyanoacrylate / construction adhesives"),

            // ── Industrial electrical (cables — Section XVI, 18%) ──
            new Seed("Cables & Wires",            "8544.4210", "Meter",                  48, "Goods at Standard Rate (default)", "Insulated wire, industrial cables"),
        };

        public static async Task SeedAsync(AppDbContext ctx)
        {
            // 0) One-time cleanup of legacy seed rows. The marker check
            //    inside CleanupAsync makes this no-op on subsequent boots.
            await CleanupLegacySeedsAsync(ctx);

            // Composite (Name, HSCode) is now the catalog identity (2026-05-16).
            // Skip seed only when an existing non-deleted row already has the
            // exact same pair — otherwise re-seeding "Hardware Items" with HS
            // code X is fine even when the operator has their own "Hardware
            // Items" with HS Y. Soft-deleted rows are excluded so a seed
            // re-create after a delete is permitted (the filtered unique
            // index already allows that path).
            var existingPairs = new HashSet<(string Name, string Hs)>(
                await ctx.ItemTypes
                    .Where(it => !it.IsDeleted)
                    .Select(it => new { it.Name, it.HSCode })
                    .ToListAsync()
                    .ContinueWith(t => t.Result.Select(x => (
                        Name: (x.Name ?? "").Trim().ToLowerInvariant(),
                        Hs: (x.HSCode ?? "").Trim().ToLowerInvariant())))
            );

            var toAdd = new List<ItemType>();
            foreach (var d in Defaults)
            {
                var key = ((d.Name ?? "").Trim().ToLowerInvariant(), (d.HSCode ?? "").Trim().ToLowerInvariant());
                if (existingPairs.Contains(key)) continue;
                toAdd.Add(new ItemType
                {
                    Name = d.Name ?? "",
                    HSCode = d.HSCode,
                    UOM = d.UOM,
                    FbrUOMId = d.FbrUOMId,
                    SaleType = d.SaleType,
                    FbrDescription = d.FbrDescription,
                    IsFavorite = true,
                });
            }

            if (toAdd.Count > 0)
            {
                ctx.ItemTypes.AddRange(toAdd);
                await ctx.SaveChangesAsync();
            }
        }

        // One-shot cleanup that drops legacy seed rows known to misclassify
        // (FMCG / 3rd-Schedule items the v1 seeder labelled as standard rate).
        // Gated by an audit-log marker so it runs at most once per database.
        // Skips any row currently referenced by a DeliveryItem to preserve
        // FK integrity — operator can clear those references manually first
        // if they want a hard reset.
        private static async Task CleanupLegacySeedsAsync(AppDbContext ctx)
        {
            // Marker check — once-only behaviour.
            var alreadyDone = await ctx.AuditLogs
                .AsNoTracking()
                .AnyAsync(a => a.ExceptionType == ReseedMarkerKey);
            if (alreadyDone) return;

            try
            {
                await CleanupLegacySeedsCoreAsync(ctx);
            }
            catch (Exception ex)
            {
                // Defensive: never let cleanup failures break startup.
                // Marker is NOT written, so the next deploy retries.
                ctx.ChangeTracker.Clear();
                ctx.AuditLogs.Add(new Models.AuditLog
                {
                    Level = "Error",
                    ExceptionType = "ITEM_TYPE_RESEED_V2_FAILED",
                    Message = $"Legacy ItemType cleanup failed: {ex.Message}",
                    StackTrace = ex.ToString().Length > 4000 ? ex.ToString()[..4000] : ex.ToString(),
                    HttpMethod = "STARTUP",
                    RequestPath = "/seed/itemtypes/cleanup",
                    StatusCode = 500,
                });
                try { await ctx.SaveChangesAsync(); } catch { /* swallow */ }
            }
        }

        private static async Task CleanupLegacySeedsCoreAsync(AppDbContext ctx)
        {
            int deleted = 0, skippedInUse = 0, missing = 0;
            var skippedNames = new List<string>();

            foreach (var (name, hs) in LegacySeedRows)
            {
                // Match by either name OR hs code so renames don't slip past.
                var rows = await ctx.ItemTypes
                    .Where(it => it.Name == name || it.HSCode == hs)
                    .ToListAsync();

                if (rows.Count == 0) { missing++; continue; }

                foreach (var row in rows)
                {
                    // Two FK paths reference ItemType: DeliveryItem.ItemTypeId
                    // AND InvoiceItem.ItemTypeId. Both must be empty before
                    // we can drop the row — otherwise the SQL Server FK
                    // check rejects the DELETE and rolls back the whole
                    // batch (the user's startup crash from the prior run).
                    var usedInChallans = await ctx.DeliveryItems
                        .AsNoTracking()
                        .AnyAsync(di => di.ItemTypeId == row.Id);
                    var usedInBills = await ctx.InvoiceItems
                        .AsNoTracking()
                        .AnyAsync(ii => ii.ItemTypeId == row.Id);
                    if (usedInChallans || usedInBills)
                    {
                        skippedInUse++;
                        skippedNames.Add($"{row.Name} ({row.HSCode})");
                        continue;
                    }

                    ctx.ItemTypes.Remove(row);
                    deleted++;
                }
            }

            // Audit row doubles as the marker — its presence prevents re-runs.
            ctx.AuditLogs.Add(new Models.AuditLog
            {
                Level = "Info",
                ExceptionType = ReseedMarkerKey,
                Message = $"Legacy ItemType seed cleanup: deleted={deleted}, skipped(in-use)={skippedInUse}, not-found={missing}.",
                StackTrace = skippedNames.Count > 0
                    ? "In-use rows preserved: " + string.Join("; ", skippedNames)
                    : null,
                HttpMethod = "STARTUP",
                RequestPath = "/seed/itemtypes/cleanup",
                StatusCode = 200,
            });

            await ctx.SaveChangesAsync();
        }
    }
}
