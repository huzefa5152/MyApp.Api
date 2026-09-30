using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data;

/// <summary>Add optional rich-text note fields to the template picker without
/// changing any existing template or relying on hard-coded seed IDs.</summary>
public static class DocumentNotesMergeFieldSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        var types = new[] { "SalesQuote", "Challan", "Bill", "TaxInvoice", "PurchaseBill", "GoodsReceipt", "Payment", "Receipt" };
        var existing = await db.MergeFields.AsNoTracking()
            .Where(f => types.Contains(f.TemplateType) && f.FieldExpression == "{{{richText notes}}}")
            .Select(f => f.TemplateType).ToListAsync();
        var have = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = types.Where(t => !have.Contains(t)).Select(t => new MergeField
        {
            TemplateType = t,
            FieldExpression = "{{{richText notes}}}",
            Label = "Notes (formatted)",
            Category = "Document",
            SortOrder = 98,
        }).ToList();
        if (missing.Count == 0) return;
        db.MergeFields.AddRange(missing);
        await db.SaveChangesAsync();
    }
}
