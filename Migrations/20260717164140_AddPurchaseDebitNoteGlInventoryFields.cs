using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseDebitNoteGlInventoryFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "GSTRate",
                table: "PurchaseDebitNotes",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "AccountId",
                table: "PurchaseDebitNoteItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HSCode",
                table: "PurchaseDebitNoteItems",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ItemTypeId",
                table: "PurchaseDebitNoteItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ItemTypeName",
                table: "PurchaseDebitNoteItems",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNoteItems_AccountId",
                table: "PurchaseDebitNoteItems",
                column: "AccountId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNoteItems_ItemTypeId",
                table: "PurchaseDebitNoteItems",
                column: "ItemTypeId");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseDebitNoteItems_Accounts_AccountId",
                table: "PurchaseDebitNoteItems",
                column: "AccountId",
                principalTable: "Accounts",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseDebitNoteItems_ItemTypes_ItemTypeId",
                table: "PurchaseDebitNoteItems",
                column: "ItemTypeId",
                principalTable: "ItemTypes",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseDebitNoteItems_Accounts_AccountId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseDebitNoteItems_ItemTypes_ItemTypeId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseDebitNoteItems_AccountId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseDebitNoteItems_ItemTypeId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropColumn(
                name: "GSTRate",
                table: "PurchaseDebitNotes");

            migrationBuilder.DropColumn(
                name: "AccountId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropColumn(
                name: "HSCode",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropColumn(
                name: "ItemTypeId",
                table: "PurchaseDebitNoteItems");

            migrationBuilder.DropColumn(
                name: "ItemTypeName",
                table: "PurchaseDebitNoteItems");
        }
    }
}
