using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddChallanPrivateProcurement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceDeliveryChallanId",
                table: "PurchaseBills",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ActualUnitCost",
                table: "DeliveryItems",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupplierId",
                table: "DeliveryItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills",
                columns: new[] { "SourceDeliveryChallanId", "SupplierId" },
                unique: true,
                filter: "[SourceDeliveryChallanId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryItems_SupplierId",
                table: "DeliveryItems",
                column: "SupplierId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_Suppliers_SupplierId",
                table: "DeliveryItems",
                column: "SupplierId",
                principalTable: "Suppliers",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_Suppliers_SupplierId",
                table: "DeliveryItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryItems_SupplierId",
                table: "DeliveryItems");

            migrationBuilder.DropColumn(
                name: "SourceDeliveryChallanId",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "ActualUnitCost",
                table: "DeliveryItems");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "DeliveryItems");
        }
    }
}
