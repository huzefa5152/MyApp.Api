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
    /// (https://gw.fbr.gov.pk/pdi/v1/itemdesccode).
    /// </summary>
    public static class ItemTypeSeeder
    {
        private record Seed(string Name, string HSCode, string UOM, int FbrUOMId, string SaleType, string FbrDescription);

        private static readonly Seed[] Defaults = new[]
        {
            // ── Hardware / Pneumatic (core business) ──
            new Seed("Valves (all types)",        "8481.8090", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Ball, gate, check, globe, needle, solenoid valves"),
            new Seed("Pipe Fittings (Steel)",     "7307.9900", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Elbows, tees, reducers, unions, nipples"),
            new Seed("Pneumatic Cylinders",       "8412.2900", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Pneumatic / hydraulic cylinders and actuators"),
            new Seed("Bolts, Nuts & Screws",      "7318.1590", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "All threaded hardware — bolts, nuts, screws, washers"),
            new Seed("Rubber Hoses & Fittings",   "4009.3130", "Meter",                  48, "Goods at standard rate (default)", "Pneumatic hoses, push-in fittings"),
            new Seed("Steel Pipes & Tubes",       "7304.9000", "Meter",                  48, "Goods at standard rate (default)", "Iron/steel seamless tubes and pipes"),
            new Seed("Bearings",                  "8482.1090", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Ball bearings, roller bearings"),
            new Seed("Gaskets & Seals",           "8484.1010", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Gaskets and similar joints of metal sheeting"),

            // ── Stationery ──
            new Seed("Pencils",                   "9609.2020", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Pencils, mechanical pencils"),
            new Seed("Pens & Markers",            "9608.9100", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Ball pens, felt-tipped markers, highlighters"),
            new Seed("Paper & Files",             "4820.1010", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Notebooks, registers, files, envelopes"),
            new Seed("Adhesive Tape",             "3919.1090", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Self-adhesive tape, masking tape, scotch tape"),
            new Seed("Glue & Adhesives",          "3506.9110", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Glue sticks, paste, liquid glue"),

            // ── Cleaning / Safety ──
            new Seed("Soap",                      "3401.1910", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Bar soap, toilet soap"),
            new Seed("Detergent",                 "3402.2000", "KG",                     13, "Goods at standard rate (default)", "Washing powder, dishwash liquid"),
            new Seed("Face Masks",                "6307.9090", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Cloth masks, surgical masks"),

            // ── Electrical ──
            new Seed("Cables & Wires",            "8544.4210", "Meter",                  48, "Goods at standard rate (default)", "Insulated wire, extension cables"),
            new Seed("Batteries",                 "8506.1010", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Dry cells, AA/AAA batteries"),
            new Seed("Light Bulbs",               "8539.2210", "Numbers, pieces, units", 69, "Goods at standard rate (default)", "Incandescent and LED bulbs"),
        };

        public static async Task SeedAsync(AppDbContext ctx)
        {
            // Build a set of HS codes already present so we don't duplicate them
            var existingHs = new HashSet<string>(
                await ctx.ItemTypes
                    .Where(it => it.HSCode != null)
                    .Select(it => it.HSCode!)
                    .ToListAsync(),
                StringComparer.OrdinalIgnoreCase);

            // Also skip by name match so a renamed user item doesn't get duplicated
            var existingNames = new HashSet<string>(
                await ctx.ItemTypes.Select(it => it.Name).ToListAsync(),
                StringComparer.OrdinalIgnoreCase);

            var toAdd = new List<ItemType>();
            foreach (var d in Defaults)
            {
                if (existingHs.Contains(d.HSCode) || existingNames.Contains(d.Name)) continue;
                toAdd.Add(new ItemType
                {
                    Name = d.Name,
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
    }
}
