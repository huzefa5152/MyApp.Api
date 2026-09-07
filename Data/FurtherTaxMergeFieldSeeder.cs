using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the further-tax (s.3(1A)) merge fields on
    /// the Bill and Tax Invoice print templates.
    ///
    /// Templates in the field already referenced <c>{{furtherTaxRate}}</c> and
    /// <c>{{furtherTaxAmount}}</c> — operators had built the row expecting it to
    /// work — but neither existed on any print DTO, so the row printed with an
    /// empty amount. Both are real now and these are the fields for them.
    ///
    /// Further tax is NOT an adjustment sitting outside the invoice the way
    /// withholding and advance income tax are: it is part of the supply's tax,
    /// charged on the same net base as sales tax, and it is already INSIDE
    /// GrandTotal. A template must therefore show it as a component of the
    /// total, not as something added after it.
    ///
    /// THE RATE USES {{fmtQty}}, NOT {{fmt}} — the same reason as the
    /// withholding rate: {{fmt}} rounds to whole numbers, so a fractional rate
    /// would print as 0%.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c>, for the reason
    /// <see cref="AdvanceTaxMergeFieldSeeder"/> records: the Bill and TaxInvoice
    /// merge fields carry hard-coded HasData ids and adding to that range
    /// collides with rows operators created themselves.
    /// </summary>
    public static class FurtherTaxMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>();
            foreach (var type in new[] { "Bill", "TaxInvoice" })
            {
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmtQty furtherTaxRate}}",
                    Label = "Further Tax % (keeps decimals)",
                    Category = "Totals", SortOrder = 45,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmtDec furtherTaxAmount}}",
                    Label = "Further Tax amount (already inside the grand total)",
                    Category = "Totals", SortOrder = 46,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt furtherTaxAmount}}",
                    Label = "Further Tax amount (whole rupees)",
                    Category = "Totals", SortOrder = 47,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type,
                    FieldExpression = "{{fmtDec totalBeforeFurtherTax}}",
                    Label = "Total excl. further tax (2dp — sums the item column)",
                    Category = "Totals", SortOrder = 49,
                });
                if (type == "TaxInvoice")
                {
                    defs.Add(new MergeField
                    {
                        TemplateType = type,
                        FieldExpression = "{{fmt totalBeforeFurtherTaxRounded}}",
                        Label = "Total excl. further tax (whole rupees — sums the item columns)",
                        Category = "Totals", SortOrder = 48,
                    });
                }
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{#if furtherTaxAmount}}",
                    Label = "If: Has Further Tax",
                    Category = "Conditionals", SortOrder = 62,
                });
            }

            var wantedExprs = defs.Select(d => d.FieldExpression).Distinct().ToList();
            var existing = await db.MergeFields
                .Where(m => wantedExprs.Contains(m.FieldExpression))
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
