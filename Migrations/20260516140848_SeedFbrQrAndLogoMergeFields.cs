using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeedFbrQrAndLogoMergeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 2026-05-16 — replaces the previous template's reliance on
            //   • https://quickchart.io/qr?...{{fbrIRN}}   (external HTTPS image,
            //     blocked under strict CSP and leaks the IRN)
            //   • /data/images/fbr-logo.png                 (gitignored runtime
            //     folder — file isn't deployed, 404 on production)
            // with two self-contained merge fields:
            //   • {{{fbrQrPngDataUrl}}}  — base64 QR rendered server-side
            //   • {{fbrLogoUrl}}         — stable wwwroot-served logo path
            //
            // 2026-05-16 (post-mortem) — the original draft of this migration
            // hardcoded Id=104,105. MergeFields.Id is an IDENTITY column and
            // the API exposes POST /api/mergefields (config.mergefields.manage),
            // so any admin-created custom merge field has already consumed
            // 104+. The hardcoded INSERTs hit a PK collision and ASP.NET Core
            // crashed at startup (500.30) because EF wraps the migration in
            // a transaction and the whole thing rolls back. We now let
            // IDENTITY pick the Id and guard each row with IF NOT EXISTS on
            // the unique (TemplateType, FieldExpression) — idempotent and
            // safe regardless of how many custom rows already exist.
            migrationBuilder.Sql(@"
IF NOT EXISTS (SELECT 1 FROM MergeFields WHERE TemplateType = 'TaxInvoice' AND FieldExpression = '{{{fbrQrPngDataUrl}}}')
    INSERT INTO MergeFields (Category, FieldExpression, Label, SortOrder, TemplateType)
    VALUES ('FBR', '{{{fbrQrPngDataUrl}}}', 'FBR QR Code (base64 PNG)', 64, 'TaxInvoice');

IF NOT EXISTS (SELECT 1 FROM MergeFields WHERE TemplateType = 'TaxInvoice' AND FieldExpression = '{{fbrLogoUrl}}')
    INSERT INTO MergeFields (Category, FieldExpression, Label, SortOrder, TemplateType)
    VALUES ('FBR', '{{fbrLogoUrl}}', 'FBR Logo URL', 65, 'TaxInvoice');
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Down keys off (TemplateType, FieldExpression) — same identity
            // we used to gate the inserts — because the assigned Id is now
            // non-deterministic.
            migrationBuilder.Sql(@"
DELETE FROM MergeFields
 WHERE TemplateType = 'TaxInvoice'
   AND FieldExpression IN ('{{{fbrQrPngDataUrl}}}', '{{fbrLogoUrl}}');
");
        }
    }
}
