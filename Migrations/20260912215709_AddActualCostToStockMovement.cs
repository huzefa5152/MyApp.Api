using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddActualCostToStockMovement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ActualUnitCostExcludingTax",
                table: "StockMovements",
                type: "decimal(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ActualValueAdjustmentExcludingTax",
                table: "StockMovements",
                type: "decimal(18,2)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ActualUnitCostExcludingTax",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "ActualValueAdjustmentExcludingTax",
                table: "StockMovements");
        }
    }
}
