using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;
namespace MyApp.Api.Data;
public static class BillTaxMergeFieldSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        foreach (var type in new[] { "Bill", "TaxInvoice" })
        {
            var existing = await db.MergeFields.Where(f => f.TemplateType == type).Select(f => f.FieldExpression).ToListAsync();
            foreach (var field in new[] { ("{{taxLabel}}", "Tax label"), ("{{taxTreatment}}", "Tax treatment") })
                if (!existing.Contains(field.Item1)) db.MergeFields.Add(new MergeField {
                    TemplateType = type, FieldExpression = field.Item1, Label = field.Item2, Category = "Totals", SortOrder = 94
                });
        }
        await db.SaveChangesAsync();
    }
}
