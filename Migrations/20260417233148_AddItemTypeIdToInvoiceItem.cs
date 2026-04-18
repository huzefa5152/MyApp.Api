using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddItemTypeIdToInvoiceItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ItemTypeId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItems_ItemTypeId",
                table: "InvoiceItems",
                column: "ItemTypeId");

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceItems_ItemTypes_ItemTypeId",
                table: "InvoiceItems",
                column: "ItemTypeId",
                principalTable: "ItemTypes",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceItems_ItemTypes_ItemTypeId",
                table: "InvoiceItems");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceItems_ItemTypeId",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "ItemTypeId",
                table: "InvoiceItems");
        }
    }
}
