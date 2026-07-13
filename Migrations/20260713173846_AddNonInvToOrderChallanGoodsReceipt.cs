using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNonInvToOrderChallanGoodsReceipt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "SalesOrderItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "GoodsReceiptItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "DeliveryItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrderItems_NonInventoryItemId",
                table: "SalesOrderItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SalesOrderItem_OneItemRef",
                table: "SalesOrderItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceiptItems_NonInventoryItemId",
                table: "GoodsReceiptItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_GoodsReceiptItem_OneItemRef",
                table: "GoodsReceiptItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryItems_NonInventoryItemId",
                table: "DeliveryItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_DeliveryItem_OneItemRef",
                table: "DeliveryItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_NonInventoryItems_NonInventoryItemId",
                table: "DeliveryItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_GoodsReceiptItems_NonInventoryItems_NonInventoryItemId",
                table: "GoodsReceiptItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrderItems_NonInventoryItems_NonInventoryItemId",
                table: "SalesOrderItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_NonInventoryItems_NonInventoryItemId",
                table: "DeliveryItems");

            migrationBuilder.DropForeignKey(
                name: "FK_GoodsReceiptItems_NonInventoryItems_NonInventoryItemId",
                table: "GoodsReceiptItems");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesOrderItems_NonInventoryItems_NonInventoryItemId",
                table: "SalesOrderItems");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrderItems_NonInventoryItemId",
                table: "SalesOrderItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SalesOrderItem_OneItemRef",
                table: "SalesOrderItems");

            migrationBuilder.DropIndex(
                name: "IX_GoodsReceiptItems_NonInventoryItemId",
                table: "GoodsReceiptItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_GoodsReceiptItem_OneItemRef",
                table: "GoodsReceiptItems");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryItems_NonInventoryItemId",
                table: "DeliveryItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_DeliveryItem_OneItemRef",
                table: "DeliveryItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "SalesOrderItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "GoodsReceiptItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "DeliveryItems");
        }
    }
}
