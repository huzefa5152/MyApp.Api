using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

public static class FreightMergeFieldSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        var definitions = new[]
        {
            ("{{fmtDec freightCharges}}", "Freight / cartage charges"),
            ("{{fmtDec totalBeforeFreight}}", "Total before freight"),
            ("{{fmtDec commercialTotal}}", "Commercial invoice total")
        };
        var existing = await db.MergeFields.AsNoTracking()
            .Where(f => f.TemplateType == "Bill")
            .Select(f => f.FieldExpression).ToListAsync();
        var missing = definitions.Where(d => !existing.Contains(d.Item1))
            .Select((d, index) => new MergeField
            {
                TemplateType = "Bill", FieldExpression = d.Item1,
                Label = d.Item2, Category = "Totals", SortOrder = 90 + index
            }).ToList();
        if (missing.Count == 0) return;
        db.MergeFields.AddRange(missing);
        await db.SaveChangesAsync();
    }
}
