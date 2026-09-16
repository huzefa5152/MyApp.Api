using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the <c>{{#each billItems}}</c> merge fields
    /// on the <c>TaxInvoice</c> template type (2026-09-16).
    ///
    /// A Sales Tax Invoice has two defensible item tables and they are not
    /// derivable from one another once a tax consultant has adjusted the
    /// filing:
    ///
    ///   • <c>{{#each items}}</c>     — what was FILED: grouped by the effective
    ///                                  (adjusted) item type, which carries the
    ///                                  HS code, at the adjusted quantity/value.
    ///   • <c>{{#each billItems}}</c> — what the CUSTOMER was billed: grouped by
    ///                                  the bill's own item type, which usually
    ///                                  has no HS code, at the real quantity and
    ///                                  value, with no overlay applied.
    ///
    /// Both are on <see cref="MyApp.Api.DTOs.PrintTaxInvoiceDto"/>; the template
    /// picks one. Existing templates bind only <c>items</c> and are untouched.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c> for the reason the
    /// other runtime seeders record: the TaxInvoice merge fields in
    /// <c>AppDbContext</c> carry hard-coded ids, and operators can add their own
    /// merge fields through the UI (config.mergefields.manage), so a fixed id
    /// range collides on any database whose identity counter has moved past it.
    /// Keyed on the unique (TemplateType, FieldExpression) index, so running on
    /// every boot is a no-op once seeded.
    /// </summary>
    public static class TaxInvoiceBillItemsMergeFieldSeeder
    {
        private const string T = "TaxInvoice";

        public static async Task SeedAsync(AppDbContext db)
        {
            // SortOrder 90+ keeps these below the existing Items block in the
            // picker, so the filed view stays the first thing an operator sees.
            var defs = new List<MergeField>
            {
                new() { TemplateType = T, FieldExpression = "{{#each billItems}}", Label = "Loop: Bill Items Start (as billed, not as filed)", Category = "Bill Items", SortOrder = 90 },
                new() { TemplateType = T, FieldExpression = "{{/each}}", Label = "Loop: End", Category = "Bill Items", SortOrder = 91 },
                new() { TemplateType = T, FieldExpression = "{{this.itemTypeName}}", Label = "Bill Item Type (in loop)", Category = "Bill Items", SortOrder = 92 },
                new() { TemplateType = T, FieldExpression = "{{this.description}}", Label = "Bill Item Description (in loop)", Category = "Bill Items", SortOrder = 93 },
                new() { TemplateType = T, FieldExpression = "{{fmtQty this.quantity}}", Label = "Bill Quantity — summed per item type (in loop)", Category = "Bill Items", SortOrder = 94 },
                new() { TemplateType = T, FieldExpression = "{{this.uom}}", Label = "Bill UOM (in loop)", Category = "Bill Items", SortOrder = 95 },
                new() { TemplateType = T, FieldExpression = "{{fmt this.unitPrice}}", Label = "Bill Unit Price — value ÷ quantity (in loop)", Category = "Bill Items", SortOrder = 96 },
                new() { TemplateType = T, FieldExpression = "{{fmt this.valueExclTax}}", Label = "Bill Value excl. Sales Tax (in loop)", Category = "Bill Items", SortOrder = 97 },
                new() { TemplateType = T, FieldExpression = "{{this.gstRate}}", Label = "Bill Sales Tax Rate % (in loop)", Category = "Bill Items", SortOrder = 98 },
                new() { TemplateType = T, FieldExpression = "{{fmt this.gstAmount}}", Label = "Bill Sales Tax Amount (in loop)", Category = "Bill Items", SortOrder = 99 },
                new() { TemplateType = T, FieldExpression = "{{fmt this.totalInclTax}}", Label = "Bill Total incl. Sales Tax (in loop)", Category = "Bill Items", SortOrder = 100 },
                new() { TemplateType = T, FieldExpression = "{{this.hsCode}}", Label = "Bill HS Code — usually blank (in loop)", Category = "Bill Items", SortOrder = 101 },
            };

            var existing = (await db.MergeFields
                    .Where(m => m.TemplateType == T)
                    .Select(m => new { m.TemplateType, m.FieldExpression })
                    .ToListAsync())
                .Select(m => m.TemplateType + "|" + m.FieldExpression)
                .ToHashSet();

            // "{{/each}}" and "{{this.description}}" already exist for the filed
            // Items block, and the (TemplateType, FieldExpression) index is
            // unique — so they are skipped here rather than duplicated. They are
            // listed above only so the definition reads as a complete block.
            var toAdd = defs
                .Where(d => !existing.Contains(d.TemplateType + "|" + d.FieldExpression))
                .GroupBy(d => d.FieldExpression)
                .Select(g => g.First())
                .ToList();
            if (toAdd.Count == 0) return;

            db.MergeFields.AddRange(toAdd);
            await db.SaveChangesAsync();
        }
    }
}
