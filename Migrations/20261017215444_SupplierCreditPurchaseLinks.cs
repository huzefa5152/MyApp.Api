using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SupplierCreditPurchaseLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PurchaseBillId",
                table: "PurchaseDebitNotes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AmountCredited",
                table: "PurchaseBills",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_PurchaseBillId",
                table: "PurchaseDebitNotes",
                column: "PurchaseBillId");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseDebitNotes_PurchaseBills_PurchaseBillId",
                table: "PurchaseDebitNotes",
                column: "PurchaseBillId",
                principalTable: "PurchaseBills",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseDebitNotes_PurchaseBills_PurchaseBillId",
                table: "PurchaseDebitNotes");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseDebitNotes_PurchaseBillId",
                table: "PurchaseDebitNotes");

            migrationBuilder.DropColumn(
                name: "PurchaseBillId",
                table: "PurchaseDebitNotes");

            migrationBuilder.DropColumn(
                name: "AmountCredited",
                table: "PurchaseBills");
        }
    }
}
