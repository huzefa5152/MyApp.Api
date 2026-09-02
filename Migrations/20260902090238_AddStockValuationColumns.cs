using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStockValuationColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "SalesTaxRate",
                table: "StockMovements",
                type: "decimal(5,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "UnitCostExcludingTax",
                table: "StockMovements",
                type: "decimal(18,4)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SalesTaxRate",
                table: "OpeningStockBalances",
                type: "decimal(5,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ValueExcludingTax",
                table: "OpeningStockBalances",
                type: "decimal(18,2)",
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SalesTaxRate",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "UnitCostExcludingTax",
                table: "StockMovements");

            migrationBuilder.DropColumn(
                name: "SalesTaxRate",
                table: "OpeningStockBalances");

            migrationBuilder.DropColumn(
                name: "ValueExcludingTax",
                table: "OpeningStockBalances");
        }
    }
}
