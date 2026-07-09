using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDivisionAndDefaultToPrintTemplate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PrintTemplates_CompanyId_TemplateType",
                table: "PrintTemplates");

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "PrintTemplates",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDefault",
                table: "PrintTemplates",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Name",
                table: "PrintTemplates",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "Default");

            // Backfill: every pre-existing template becomes its company-level default.
            // Safe — the old UNIQUE (CompanyId, TemplateType) index guaranteed at most
            // one row per (company, type), and DivisionId was just added as NULL, so
            // each (CompanyId, NULL, TemplateType) scope ends up with exactly one
            // IsDefault=1 row (no UX_PrintTemplates_DefaultPerScope violation). Runs as
            // its own batch, so referencing the just-added column is fine. The column
            // default stays 0 so future inserts that omit IsDefault don't auto-default
            // to a second scope default.
            migrationBuilder.Sql("UPDATE [PrintTemplates] SET [IsDefault] = 1;");

            migrationBuilder.CreateIndex(
                name: "IX_PrintTemplates_CompanyId_TemplateType_DivisionId",
                table: "PrintTemplates",
                columns: new[] { "CompanyId", "TemplateType", "DivisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_PrintTemplates_DivisionId",
                table: "PrintTemplates",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "UX_PrintTemplates_DefaultPerScope",
                table: "PrintTemplates",
                columns: new[] { "CompanyId", "DivisionId", "TemplateType" },
                unique: true,
                filter: "[IsDefault] = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_PrintTemplates_Divisions_DivisionId",
                table: "PrintTemplates",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PrintTemplates_Divisions_DivisionId",
                table: "PrintTemplates");

            migrationBuilder.DropIndex(
                name: "IX_PrintTemplates_CompanyId_TemplateType_DivisionId",
                table: "PrintTemplates");

            migrationBuilder.DropIndex(
                name: "IX_PrintTemplates_DivisionId",
                table: "PrintTemplates");

            migrationBuilder.DropIndex(
                name: "UX_PrintTemplates_DefaultPerScope",
                table: "PrintTemplates");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "PrintTemplates");

            migrationBuilder.DropColumn(
                name: "IsDefault",
                table: "PrintTemplates");

            migrationBuilder.DropColumn(
                name: "Name",
                table: "PrintTemplates");

            migrationBuilder.CreateIndex(
                name: "IX_PrintTemplates_CompanyId_TemplateType",
                table: "PrintTemplates",
                columns: new[] { "CompanyId", "TemplateType" },
                unique: true);
        }
    }
}
