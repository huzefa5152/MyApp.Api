using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPrintTemplateStamp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "StampId",
                table: "PrintTemplates",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDefault",
                table: "CompanyStamps",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_PrintTemplates_StampId",
                table: "PrintTemplates",
                column: "StampId");

            migrationBuilder.CreateIndex(
                name: "UX_CompanyStamps_DefaultPerCompany",
                table: "CompanyStamps",
                column: "CompanyId",
                unique: true,
                filter: "[IsDefault] = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_PrintTemplates_CompanyStamps_StampId",
                table: "PrintTemplates",
                column: "StampId",
                principalTable: "CompanyStamps",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PrintTemplates_CompanyStamps_StampId",
                table: "PrintTemplates");

            migrationBuilder.DropIndex(
                name: "IX_PrintTemplates_StampId",
                table: "PrintTemplates");

            migrationBuilder.DropIndex(
                name: "UX_CompanyStamps_DefaultPerCompany",
                table: "CompanyStamps");

            migrationBuilder.DropColumn(
                name: "StampId",
                table: "PrintTemplates");

            migrationBuilder.DropColumn(
                name: "IsDefault",
                table: "CompanyStamps");
        }
    }
}
