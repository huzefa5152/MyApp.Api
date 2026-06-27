using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the "Division" (sub-company) merge fields
    /// shown in the Template Editor's field picker, across ALL document template
    /// types. A document tagged with a <see cref="Division"/> can print with the
    /// division's own branding instead of the parent company's.
    ///
    /// Only Sales Quotes carry a division today, so on the other template types
    /// these tokens resolve to empty until those documents are made
    /// division-aware — they're seeded everywhere so a template author has a
    /// consistent palette and can pre-build division letterheads.
    ///
    /// Runtime-seeded (not HasData) for the same reason as
    /// <see cref="SalesMergeFieldSeeder"/>: avoids identity-id collisions with
    /// operator-created merge fields. Keyed by the unique
    /// (TemplateType, FieldExpression) index, so re-running is a no-op.
    /// </summary>
    public static class DivisionMergeFieldSeeder
    {
        private static readonly string[] TemplateTypes =
            { "Challan", "Bill", "TaxInvoice", "SalesQuote", "SalesOrder" };

        private static IEnumerable<MergeField> FieldsFor(string type) => new[]
        {
            new MergeField { TemplateType = type, FieldExpression = "{{divisionName}}",            Label = "Division Name",                        Category = "Division",      SortOrder = 60 },
            new MergeField { TemplateType = type, FieldExpression = "{{divisionBrandName}}",       Label = "Division Brand Name",                  Category = "Division",      SortOrder = 61 },
            new MergeField { TemplateType = type, FieldExpression = "{{divisionLogoPath}}",        Label = "Division Logo URL",                    Category = "Division",      SortOrder = 62 },
            new MergeField { TemplateType = type, FieldExpression = "{{{nl2br divisionAddress}}}", Label = "Division Address (with line breaks)",  Category = "Division",      SortOrder = 63 },
            new MergeField { TemplateType = type, FieldExpression = "{{{nl2br divisionPhone}}}",   Label = "Division Phone (with line breaks)",    Category = "Division",      SortOrder = 64 },
            new MergeField { TemplateType = type, FieldExpression = "{{divisionNTN}}",             Label = "Division NTN",                         Category = "Division",      SortOrder = 65 },
            new MergeField { TemplateType = type, FieldExpression = "{{divisionSTRN}}",            Label = "Division STRN",                        Category = "Division",      SortOrder = 66 },
            new MergeField { TemplateType = type, FieldExpression = "{{divisionEmail}}",           Label = "Division Email",                       Category = "Division",      SortOrder = 67 },
            new MergeField { TemplateType = type, FieldExpression = "{{#if divisionLogoPath}}",    Label = "If: Has Division Logo (else company)", Category = "Conditionals",  SortOrder = 70 },
            new MergeField { TemplateType = type, FieldExpression = "{{#if divisionBrandName}}",   Label = "If: Has Division Brand (else company)",Category = "Conditionals",  SortOrder = 71 },
        };

        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = TemplateTypes.SelectMany(FieldsFor).ToList();

            var existing = (await db.MergeFields
                    .Where(m => TemplateTypes.Contains(m.TemplateType))
                    .Select(m => new { m.TemplateType, m.FieldExpression })
                    .ToListAsync())
                .Select(m => m.TemplateType + "|" + m.FieldExpression)
                .ToHashSet();

            var toAdd = defs
                .Where(d => !existing.Contains(d.TemplateType + "|" + d.FieldExpression))
                .ToList();
            if (toAdd.Count == 0) return;

            db.MergeFields.AddRange(toAdd);
            await db.SaveChangesAsync();
        }
    }
}
