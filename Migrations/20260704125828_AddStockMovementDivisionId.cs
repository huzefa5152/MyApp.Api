using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStockMovementDivisionId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "StockMovements",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_DivisionId",
                table: "StockMovements",
                column: "DivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_StockMovements_Divisions_DivisionId",
                table: "StockMovements",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_StockMovements_Divisions_DivisionId",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_DivisionId",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "StockMovements");
        }
    }
}
