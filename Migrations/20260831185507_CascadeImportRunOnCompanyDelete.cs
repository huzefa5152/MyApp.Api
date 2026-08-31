using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class CascadeImportRunOnCompanyDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ImportRuns_Companies_CompanyId",
                table: "ImportRuns");

            migrationBuilder.AddForeignKey(
                name: "FK_ImportRuns_Companies_CompanyId",
                table: "ImportRuns",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ImportRuns_Companies_CompanyId",
                table: "ImportRuns");

            migrationBuilder.AddForeignKey(
                name: "FK_ImportRuns_Companies_CompanyId",
                table: "ImportRuns",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
