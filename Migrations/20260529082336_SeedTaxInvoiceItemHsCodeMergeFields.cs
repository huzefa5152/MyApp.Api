using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeedTaxInvoiceItemHsCodeMergeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 2026-05-29 — surface the per-line HS Code in the Tax Invoice
            // template editor's "Insert Merge Field" picker. The DTO and
            // service mapping were extended in the same commit
            // (PrintTaxItemDto.HSCode, InvoiceService.GetPrintTaxInvoiceAsync)
            // so {{this.hsCode}} now actually carries a value at render
            // time. Two picker rows: the value and a {{#if}} guard so
            // operators can write "show HS Code only when it's present".
            //
            // Idempotent raw SQL — guards each insert on the (TemplateType,
            // FieldExpression) unique key, lets IDENTITY pick the Id (no
            // hardcoded PKs — same lesson as the FBR QR/logo migration
            // that crashed prod with a PK collision on Id=104).
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM MergeFields WHERE TemplateType = 'TaxInvoice' AND FieldExpression = '{{this.hsCode}}')
    INSERT INTO MergeFields (Category, FieldExpression, Label, SortOrder, TemplateType)
    VALUES ('Items', '{{this.hsCode}}', 'Item HS Code (in loop)', 49, 'TaxInvoice');

IF NOT EXISTS (SELECT 1 FROM MergeFields WHERE TemplateType = 'TaxInvoice' AND FieldExpression = '{{#if this.hsCode}}')
    INSERT INTO MergeFields (Category, FieldExpression, Label, SortOrder, TemplateType)
    VALUES ('Conditionals', '{{#if this.hsCode}}', 'If: Item Has HS Code', 59, 'TaxInvoice');
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Match the same (TemplateType, FieldExpression) shape used for
            // the inserts — the Id was IDENTITY-assigned so we can't key
            // off it.
            migrationBuilder.Sql(@"
DELETE FROM MergeFields
 WHERE TemplateType = 'TaxInvoice'
   AND FieldExpression IN ('{{this.hsCode}}', '{{#if this.hsCode}}');
");
        }
    }
}
