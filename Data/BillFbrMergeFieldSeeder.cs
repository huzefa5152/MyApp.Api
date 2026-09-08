using Microsoft.EntityFrameworkCore;
using MyApp.Api.Models;

namespace MyApp.Api.Data
{
    /// <summary>
    /// Idempotent runtime seeder for the FBR digital-invoicing merge fields on
    /// the <c>Bill</c> print template.
    ///
    /// TaxInvoice, CreditNote and DebitNote have carried these since 2026-04
    /// (<c>SeedFbrMergeFields</c> / <see cref="NoteAndPurchaseMergeFieldSeeder"/>),
    /// but Bill never did — even though a Bill and a Tax Invoice are the SAME
    /// <c>Invoice</c> row printed through two different templates, so a bill can
    /// perfectly well hold an IRN. The data was simply unreachable from a Bill
    /// template: no fields to insert, and until now nothing populated them on
    /// <c>PrintBillDto</c> either.
    ///
    /// Seeded at RUNTIME rather than through <c>HasData</c>, for the reason
    /// <see cref="AdvanceTaxMergeFieldSeeder"/> records: the Bill and TaxInvoice
    /// merge fields carry hard-coded HasData ids and adding to that range
    /// collides with rows operators created themselves. Keyed on the unique
    /// <c>(TemplateType, FieldExpression)</c> index, so every boot after the
    /// first is a no-op.
    ///
    /// THE QR USES TRIPLE BRACES. <c>{{{fbrQrPngDataUrl}}}</c> is a
    /// <c>data:image/png;base64,…</c> URI; with two braces Handlebars
    /// HTML-escapes it and the browser renders a broken image. The label says
    /// so, because the editor inserts whatever the label is attached to.
    ///
    /// THE LOGO PATH IS RELATIVE. <c>images/fbr-logo.png</c>, no leading slash —
    /// this installation mounts the ERP under <c>/admin/</c> and a root-relative
    /// path 404s there. See PrintBillDto.FbrLogoUrl and CLAUDE.md §5c-2.
    /// </summary>
    public static class BillFbrMergeFieldSeeder
    {
        public static async Task SeedAsync(AppDbContext db)
        {
            var defs = new List<MergeField>
            {
                new() {
                    TemplateType = "Bill", FieldExpression = "{{fbrIRN}}",
                    Label = "FBR Invoice Reference Number (IRN)",
                    Category = "FBR", SortOrder = 60,
                },
                new() {
                    TemplateType = "Bill", FieldExpression = "{{fbrStatus}}",
                    Label = "FBR Status (Submitted/Failed/Validated)",
                    Category = "FBR", SortOrder = 61,
                },
                new() {
                    TemplateType = "Bill", FieldExpression = "{{fmtDate fbrSubmittedAt}}",
                    Label = "FBR Submission Date",
                    Category = "FBR", SortOrder = 62,
                },
                new() {
                    TemplateType = "Bill", FieldExpression = "{{#if fbrIRN}}",
                    Label = "If: Has FBR IRN (wrap the whole FBR block in this)",
                    Category = "FBR", SortOrder = 63,
                },
                new() {
                    TemplateType = "Bill", FieldExpression = "{{{fbrQrPngDataUrl}}}",
                    Label = "FBR QR Code (base64 PNG — keep the TRIPLE braces)",
                    Category = "FBR", SortOrder = 64,
                },
                new() {
                    TemplateType = "Bill", FieldExpression = "{{fbrLogoUrl}}",
                    Label = "FBR Logo URL (relative — resolves under the app's base path)",
                    Category = "FBR", SortOrder = 65,
                },
            };

            var wanted = defs.Select(d => d.FieldExpression).ToList();
            var existing = await db.MergeFields
                .Where(m => m.TemplateType == "Bill" && wanted.Contains(m.FieldExpression))
                .Select(m => m.FieldExpression)
                .ToListAsync();

            var have = existing.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = defs.Where(d => !have.Contains(d.FieldExpression)).ToList();
            if (missing.Count == 0) return;

            db.MergeFields.AddRange(missing);
            await db.SaveChangesAsync();
        }
    }
}
