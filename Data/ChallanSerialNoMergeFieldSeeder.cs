using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

public static class ChallanSerialNoMergeFieldSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        if (await db.MergeFields.AnyAsync(f => f.TemplateType == "Challan"
            && f.FieldExpression == "{{this.serialNo}}")) return;

        db.MergeFields.Add(new MergeField
        {
            TemplateType = "Challan",
            FieldExpression = "{{this.serialNo}}",
            Label = "Item Serial Number (in loop)",
            Category = "Items",
            SortOrder = 32,
        });
        await db.SaveChangesAsync();
    }
}
