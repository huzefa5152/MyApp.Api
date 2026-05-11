using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class PromoteStockQuantityToDecimal : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceItemAdjustments_InvoiceItems_InvoiceItemId1",
                table: "InvoiceItemAdjustments");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceItemAdjustments_InvoiceItemId1",
                table: "InvoiceItemAdjustments");

            migrationBuilder.DropColumn(
                name: "InvoiceItemId1",
                table: "InvoiceItemAdjustments");

            migrationBuilder.AlterColumn<decimal>(
                name: "Quantity",
                table: "StockMovements",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AlterColumn<decimal>(
                name: "Quantity",
                table: "OpeningStockBalances",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                oldClrType: typeof(int),
                oldType: "int");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "Quantity",
                table: "StockMovements",
                type: "int",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,4)",
                oldPrecision: 18,
                oldScale: 4);

            migrationBuilder.AlterColumn<int>(
                name: "Quantity",
                table: "OpeningStockBalances",
                type: "int",
                nullable: false,
                oldClrType: typeof(decimal),
                oldType: "decimal(18,4)",
                oldPrecision: 18,
                oldScale: 4);

            migrationBuilder.AddColumn<int>(
                name: "InvoiceItemId1",
                table: "InvoiceItemAdjustments",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItemAdjustments_InvoiceItemId1",
                table: "InvoiceItemAdjustments",
                column: "InvoiceItemId1",
                unique: true,
                filter: "[InvoiceItemId1] IS NOT NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceItemAdjustments_InvoiceItems_InvoiceItemId1",
                table: "InvoiceItemAdjustments",
                column: "InvoiceItemId1",
                principalTable: "InvoiceItems",
                principalColumn: "Id");
        }
    }
}
