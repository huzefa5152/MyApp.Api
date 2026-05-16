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
            migrationBuilder.InsertData(
                table: "MergeFields",
                columns: new[] { "Id", "Category", "FieldExpression", "Label", "SortOrder", "TemplateType" },
                values: new object[,]
                {
                    { 104, "FBR", "{{{fbrQrPngDataUrl}}}", "FBR QR Code (base64 PNG)", 64, "TaxInvoice" },
                    { 105, "FBR", "{{fbrLogoUrl}}", "FBR Logo URL", 65, "TaxInvoice" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "MergeFields",
                keyColumn: "Id",
                keyValues: new object[] { 104, 105 });
        }
    }
}
