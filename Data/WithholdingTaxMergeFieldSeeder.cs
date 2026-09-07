using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the withholding-tax (s.153) merge fields on
    /// the Bill and Tax Invoice print templates.
    ///
    /// The data was already there — <c>Invoice.WithholdingTaxRate</c> /
    /// <c>WithholdingTaxAmount</c>, and the collectible balance from
    /// <see cref="Helpers.WithholdingTaxCalculator"/> — and PrintBillDto has
    /// carried all three since withholding tax shipped. What was missing was a
    /// field to put them in, so an operator building a template had no way to
    /// print the WHT line even on a bill that stored one.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c>, for the reason
    /// <see cref="AdvanceTaxMergeFieldSeeder"/> records: the Bill and TaxInvoice
    /// merge fields carry hard-coded HasData ids and adding to that range
    /// collides with rows operators created themselves. Keyed on the unique
    /// <c>(TemplateType, FieldExpression)</c> index, so every boot after the
    /// first is a no-op.
    ///
    /// THE RATE USES {{fmtQty}}, NOT {{fmt}}. Withholding rates are decimal
    /// percentages — 0.1%, 0.5%, 2%, 2.5% — and {{fmt}} formats to zero decimal
    /// places, which prints a 0.1% rate as "0%". fmtQty keeps up to 12 decimals
    /// and shows none it does not need, so 0.1 reads "0.1" and 2 reads "2".
    ///
    /// When no withholding applies the amount is 0 and the net equals the grand
    /// total, so a template that prints the row unconditionally shows a
    /// harmless zero; the "If: Has Withholding Tax" conditional is there for
    /// one that would rather hide the row entirely, matching how the advance-tax
    /// fields already behave.
    /// </summary>
    public static class WithholdingTaxMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>();
            foreach (var type in new[] { "Bill", "TaxInvoice" })
            {
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmtQty withholdingTaxRate}}",
                    Label = "WHT Rate % (keeps decimals — 0.1, 0.5, 2.5)",
                    Category = "Totals", SortOrder = 50,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmtDec withholdingTaxAmount}}",
                    Label = "WHT Amount (withheld by the buyer)",
                    Category = "Totals", SortOrder = 51,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmtDec balanceDueAfterWht}}",
                    Label = "Total after WHT (what the buyer pays)",
                    Category = "Totals", SortOrder = 52,
                });
                // Whole-rupee variants, for a template printing rounded money.
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt withholdingTaxAmount}}",
                    Label = "WHT Amount (whole rupees)",
                    Category = "Totals", SortOrder = 53,
                });
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{fmt balanceDueAfterWht}}",
                    Label = "Total after WHT (whole rupees)",
                    Category = "Totals", SortOrder = 54,
                });
                // The final line on a document carrying either income tax.
                // Only the TaxInvoice DTO exposes it; the Bill template keeps
                // the two single-tax fields it already had.
                if (type == "TaxInvoice")
                {
                    defs.Add(new MergeField
                    {
                        TemplateType = type, FieldExpression = "{{fmtDec collectible}}",
                        Label = "Net payable — less WHT, plus advance tax",
                        Category = "Totals", SortOrder = 55,
                    });
                    defs.Add(new MergeField
                    {
                        TemplateType = type, FieldExpression = "{{fmt collectibleRounded}}",
                        Label = "Net payable (whole rupees — adds up to the rows above)",
                        Category = "Totals", SortOrder = 56,
                    });
                }
                // So a template shows the row only on the documents that carry it.
                defs.Add(new MergeField
                {
                    TemplateType = type, FieldExpression = "{{#if withholdingTaxAmount}}",
                    Label = "If: Has Withholding Tax",
                    Category = "Conditionals", SortOrder = 61,
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
