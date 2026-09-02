using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDeliveryItemInvoiceItemLink : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "InvoiceItemId",
                table: "DeliveryItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryItems_InvoiceItemId",
                table: "DeliveryItems",
                column: "InvoiceItemId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_InvoiceItems_InvoiceItemId",
                table: "DeliveryItems",
                column: "InvoiceItemId",
                principalTable: "InvoiceItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_InvoiceItems_InvoiceItemId",
                table: "DeliveryItems");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryItems_InvoiceItemId",
                table: "DeliveryItems");

            migrationBuilder.DropColumn(
                name: "InvoiceItemId",
                table: "DeliveryItems");
        }
    }
}
