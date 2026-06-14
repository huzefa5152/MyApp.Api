using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSalesQuoteDivision : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "SalesQuotes",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_DivisionId",
                table: "SalesQuotes",
                column: "DivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesQuotes_Divisions_DivisionId",
                table: "SalesQuotes",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SalesQuotes_Divisions_DivisionId",
                table: "SalesQuotes");

            migrationBuilder.DropIndex(
                name: "IX_SalesQuotes_DivisionId",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "SalesQuotes");
        }
    }
}
