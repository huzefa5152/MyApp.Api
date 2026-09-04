using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the WHOLE-RUPEE money fields on the Tax
    /// Invoice print template (operator request 2026-09-04: the Value Excl.
    /// Tax, Sales Tax and Value Incl. Tax columns printed rounded).
    ///
    /// Seeded at runtime for the same reason as
    /// <see cref="AdvanceTaxMergeFieldSeeder"/>: the TaxInvoice merge fields
    /// carry hard-coded HasData ids and adding to that range collides with rows
    /// operators created themselves. Keyed on the unique
    /// <c>(TemplateType, FieldExpression)</c> index, so every boot after the
    /// first is a no-op.
    ///
    /// Rounding is offered as SEPARATE fields rather than by changing what the
    /// existing ones mean, because it is a per-template choice: a tenant that
    /// files with FBR wants the printed document to carry the same figures it
    /// filed, to the paisa. Only a template that opts in prints rounded.
    ///
    /// The totals are the sum of the rounded LINES, not the rounded totals --
    /// see PrintTaxInvoiceDto.SubtotalRounded for why. A template must use the
    /// rounded fields on BOTH the lines and the total row, or the column will
    /// not add up; the labels say so.
    /// </summary>
    public static class RoundedTaxMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>
            {
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt this.valueExclTaxRounded}}",
                    Label = "Line: Value Excl. Tax (whole rupees)", Category = "Items", SortOrder = 70,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt this.gstAmountRounded}}",
                    Label = "Line: Sales Tax (whole rupees)", Category = "Items", SortOrder = 71,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt this.totalInclTaxRounded}}",
                    Label = "Line: Value Incl. Tax (whole rupees)", Category = "Items", SortOrder = 72,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt subtotalRounded}}",
                    Label = "Total: Excluding tax (whole rupees — sums the rounded lines)",
                    Category = "Totals", SortOrder = 70,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt gstAmountRounded}}",
                    Label = "Total: Sales tax (whole rupees — sums the rounded lines)",
                    Category = "Totals", SortOrder = 71,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{fmt grandTotalRounded}}",
                    Label = "Total: Including tax (whole rupees — sums the rounded lines)",
                    Category = "Totals", SortOrder = 72,
                },
                new() {
                    TemplateType = "TaxInvoice", FieldExpression = "{{amountInWordsRounded}}",
                    Label = "Amount in words (matches the rounded total)",
                    Category = "Totals", SortOrder = 73,
                },
            };

            var wantedExprs = defs.Select(d => d.FieldExpression).ToList();
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
