using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the document's own REFERENCE number on the
    /// Bill and Tax Invoice print templates.
    ///
    /// A bill carries two numbers and they are not interchangeable:
    ///
    ///   <c>{{invoiceNumber}}</c>     the internal sequence — unique per
    ///                                company, what every screen and report
    ///                                keys on.
    ///   <c>{{fbrInvoiceNumber}}</c>  the company's <c>InvoiceNumberPrefix</c>
    ///                                followed by that number ("PTC-52"), plus
    ///                                "CN-"/"DN-" on a note. This is the
    ///                                reference on the copy the customer holds.
    ///
    /// The prefix has been configurable under Configuration → Companies →
    /// Numbering since the FBR work introduced the column, but it appeared on no
    /// screen and in no template — a company filing as "PTC-" printed a bare
    /// "52", so the reference the customer quoted back matched nothing. These
    /// fields make it reachable from a template an operator has already
    /// customised; the built-in Bill and Tax Invoice templates print it in the
    /// number position themselves.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c>, for the reason
    /// <see cref="AdvanceTaxMergeFieldSeeder"/> records: the Bill and TaxInvoice
    /// merge fields carry hard-coded HasData ids and adding to that range
    /// collides with rows operators created themselves. Keyed on the unique
    /// <c>(TemplateType, FieldExpression)</c> index, so every boot after the
    /// first is a no-op.
    ///
    /// PLAIN, NOT AN `or` SUBEXPRESSION. The Excel export path
    /// (<see cref="Helpers.ExcelTemplateEngine"/>) resolves a field name, not a
    /// Handlebars helper call, so the expression offered here has to be one both
    /// engines understand. The fallback belongs in the template, not the label.
    /// </summary>
    public static class InvoiceReferenceMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>();
            foreach (var (type, label, sort) in new[]
            {
                ("Bill", "Bill Reference (company prefix + number, e.g. PTC-52)", 11),
                ("TaxInvoice", "Invoice Reference (company prefix + number, e.g. PTC-52)", 21),
            })
            {
                defs.Add(new MergeField
                {
                    TemplateType = type,
                    FieldExpression = "{{fbrInvoiceNumber}}",
                    Label = label,
                    Category = "Document",
                    SortOrder = sort,
                });
            }

            var types = defs.Select(d => d.TemplateType).ToList();
            var existing = await db.MergeFields
                .Where(m => types.Contains(m.TemplateType)
                            && m.FieldExpression == "{{fbrInvoiceNumber}}")
                .Select(m => m.TemplateType)
                .ToListAsync();

            var have = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = defs.Where(d => !have.Contains(d.TemplateType)).ToList();
            if (missing.Count == 0) return;

            db.MergeFields.AddRange(missing);
            await db.SaveChangesAsync();
        }
    }
}
