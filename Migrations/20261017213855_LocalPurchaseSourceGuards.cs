using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class LocalPurchaseSourceGuards : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseItems_DeliveryItems_LocalDeliveryItemId",
                table: "PurchaseItems",
                column: "LocalDeliveryItemId",
                principalTable: "DeliveryItems",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseItems_InvoiceItems_LocalInvoiceItemId",
                table: "PurchaseItems",
                column: "LocalInvoiceItemId",
                principalTable: "InvoiceItems",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseItems_DeliveryItems_LocalDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseItems_InvoiceItems_LocalInvoiceItemId",
                table: "PurchaseItems");
        }
    }
}
