using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeedFbrMergeFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.InsertData(
                table: "MergeFields",
                columns: new[] { "Id", "Category", "FieldExpression", "Label", "SortOrder", "TemplateType" },
                values: new object[,]
                {
                    { 100, "FBR", "{{fbrIRN}}", "FBR Invoice Reference Number (IRN)", 60, "TaxInvoice" },
                    { 101, "FBR", "{{fbrStatus}}", "FBR Status (Submitted/Failed/Validated)", 61, "TaxInvoice" },
                    { 102, "FBR", "{{fmtDate fbrSubmittedAt}}", "FBR Submission Date", 62, "TaxInvoice" },
                    { 103, "FBR", "{{#if fbrIRN}}", "If: Has FBR IRN (for conditional FBR section)", 63, "TaxInvoice" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DeleteData(
                table: "MergeFields",
                keyColumn: "Id",
                keyValues: new object[] { 100, 101, 102, 103 });
        }
    }
}
