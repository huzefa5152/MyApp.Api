using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddNonInventoryItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "SalesQuoteItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "PurchaseItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "NonInventoryItemId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "NonInventoryItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Code = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    UnitName = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    SaleAccountId = table.Column<int>(type: "int", nullable: true),
                    PurchaseAccountId = table.Column<int>(type: "int", nullable: true),
                    DefaultLineDescription = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    DefaultSalePrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    DefaultPurchasePrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    HideNameOnPrint = table.Column<bool>(type: "bit", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
                    ExternalRef = table.Column<string>(type: "nvarchar(80)", maxLength: 80, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NonInventoryItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NonInventoryItems_Accounts_PurchaseAccountId",
                        column: x => x.PurchaseAccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_NonInventoryItems_Accounts_SaleAccountId",
                        column: x => x.SaleAccountId,
                        principalTable: "Accounts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_NonInventoryItems_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuoteItems_NonInventoryItemId",
                table: "SalesQuoteItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_SalesQuoteItem_OneItemRef",
                table: "SalesQuoteItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_NonInventoryItemId",
                table: "PurchaseItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_PurchaseItem_OneItemRef",
                table: "PurchaseItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItems_NonInventoryItemId",
                table: "InvoiceItems",
                column: "NonInventoryItemId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_InvoiceItem_OneItemRef",
                table: "InvoiceItems",
                sql: "[ItemTypeId] IS NULL OR [NonInventoryItemId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_NonInventoryItems_CompanyId_Name",
                table: "NonInventoryItems",
                columns: new[] { "CompanyId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NonInventoryItems_PurchaseAccountId",
                table: "NonInventoryItems",
                column: "PurchaseAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_NonInventoryItems_SaleAccountId",
                table: "NonInventoryItems",
                column: "SaleAccountId");

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceItems_NonInventoryItems_NonInventoryItemId",
                table: "InvoiceItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseItems_NonInventoryItems_NonInventoryItemId",
                table: "PurchaseItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesQuoteItems_NonInventoryItems_NonInventoryItemId",
                table: "SalesQuoteItems",
                column: "NonInventoryItemId",
                principalTable: "NonInventoryItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceItems_NonInventoryItems_NonInventoryItemId",
                table: "InvoiceItems");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseItems_NonInventoryItems_NonInventoryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesQuoteItems_NonInventoryItems_NonInventoryItemId",
                table: "SalesQuoteItems");

            migrationBuilder.DropTable(
                name: "NonInventoryItems");

            migrationBuilder.DropIndex(
                name: "IX_SalesQuoteItems_NonInventoryItemId",
                table: "SalesQuoteItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_SalesQuoteItem_OneItemRef",
                table: "SalesQuoteItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_NonInventoryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_PurchaseItem_OneItemRef",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceItems_NonInventoryItemId",
                table: "InvoiceItems");

            migrationBuilder.DropCheckConstraint(
                name: "CK_InvoiceItem_OneItemRef",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "SalesQuoteItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "NonInventoryItemId",
                table: "InvoiceItems");
        }
    }
}
