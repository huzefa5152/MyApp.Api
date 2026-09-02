using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the advance-income-tax (236G / 236H) merge
    /// fields on the Bill and Tax Invoice print templates.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c>, for the reason
    /// <see cref="SalesMergeFieldSeeder"/> already records: the Bill and
    /// TaxInvoice merge fields carry hard-coded HasData ids, and adding to that
    /// range collides with rows operators have created themselves through
    /// config.mergefields.manage. Keyed on the unique
    /// <c>(TemplateType, FieldExpression)</c> index, so every boot after the
    /// first is a no-op.
    ///
    /// The client's own format already prints the row -- "Advanced Income Tax
    /// 236-G" followed by a Total beneath Including -- so what was missing was
    /// a field to put the figure in. <c>advanceTaxLabel</c> carries the whole
    /// caption including the hyphenated section, so a template that wants the
    /// section to follow the operator's choice can use it in place of fixed
    /// text.
    /// </summary>
    public static class AdvanceTaxMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>();
            foreach (var type in new[] { "Bill", "TaxInvoice" })
            {
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt advanceTaxAmount}}",
                    Label = "Advance Income Tax (formatted)", Category = "Totals", SortOrder = 40,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{advanceTaxSection}}",
                    Label = "Advance Tax Section (236G / 236H)", Category = "Totals", SortOrder = 41,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{advanceTaxLabel}}",
                    Label = "Advance Tax Row Label (e.g. Advanced Income Tax 236-G)",
                    Category = "Totals", SortOrder = 42,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt advanceTaxRate}}",
                    Label = "Advance Tax Rate %", Category = "Totals", SortOrder = 43,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt totalWithAdvanceTax}}",
                    Label = "Total incl. Advance Tax (formatted)", Category = "Totals", SortOrder = 44,
                });
                // So a template shows the row only on the bills that carry it.
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{#if advanceTaxAmount}}",
                    Label = "If: Has Advance Tax", Category = "Conditionals", SortOrder = 60,
                });
            }

            var wanted = defs.Select(d => new { d.TemplateType, d.FieldExpression }).ToList();
            var existing = await db.MergeFields
                .Where(m => wanted.Select(w => w.FieldExpression).Contains(m.FieldExpression))
                .Select(m => new { m.TemplateType, m.FieldExpression })
                .ToListAsync();

            var have = existing
                .Select(e => $"{e.TemplateType}|{e.FieldExpression}")
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var missing = defs
                .Where(d => !have.Contains($"{d.TemplateType}|{d.FieldExpression}"))
                .ToList();

            if (missing.Count == 0) return;

            db.MergeFields.AddRange(missing);
            await db.SaveChangesAsync();
        }
    }
}
