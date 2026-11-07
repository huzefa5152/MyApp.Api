using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class LinkPurchaseLinesToChallanLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SourceDeliveryItemId",
                table: "PurchaseItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_SourceDeliveryItemId",
                table: "PurchaseItems",
                column: "SourceDeliveryItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseItems_DeliveryItems_SourceDeliveryItemId",
                table: "PurchaseItems",
                column: "SourceDeliveryItemId",
                principalTable: "DeliveryItems",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseItems_DeliveryItems_SourceDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_SourceDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "SourceDeliveryItemId",
                table: "PurchaseItems");
        }
    }
}
