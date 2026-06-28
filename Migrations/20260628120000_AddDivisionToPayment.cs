using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDivisionToPayment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "Payments",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Payments_DivisionId",
                table: "Payments",
                column: "DivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_Payments_Divisions_DivisionId",
                table: "Payments",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Payments_Divisions_DivisionId",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_Payments_DivisionId",
                table: "Payments");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "Payments");
        }
    }
}
