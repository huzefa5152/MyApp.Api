using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class CommercialCostsAndLocalPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LocalDeliveryItemId",
                table: "PurchaseItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocalInvoiceItemId",
                table: "PurchaseItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PurchaseCategory",
                table: "PurchaseBills",
                type: "nvarchar(24)",
                maxLength: 24,
                nullable: false,
                defaultValue: "Inventory");

            migrationBuilder.Sql("UPDATE PurchaseBills SET PurchaseCategory = 'LocalDirect' WHERE Source = 'challan-supplier'");

            migrationBuilder.AddColumn<int>(
                name: "SourceInvoiceId",
                table: "PurchaseBills",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ActualUnitCost",
                table: "InvoiceItems",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SupplierId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "PrivateCostChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ActorId = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Target = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    TargetId = table.Column<int>(type: "int", nullable: false),
                    BeforeJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    AfterJson = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PrivateCostChanges", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_LocalDeliveryItemId",
                table: "PurchaseItems",
                column: "LocalDeliveryItemId",
                unique: true,
                filter: "[LocalDeliveryItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_LocalInvoiceItemId",
                table: "PurchaseItems",
                column: "LocalInvoiceItemId",
                unique: true,
                filter: "[LocalInvoiceItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PrivateCostChanges_CompanyId_Target_TargetId",
                table: "PrivateCostChanges",
                columns: new[] { "CompanyId", "Target", "TargetId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PrivateCostChanges");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalInvoiceItemId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "LocalDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "LocalInvoiceItemId",
                table: "PurchaseItems");

            migrationBuilder.DropColumn(
                name: "PurchaseCategory",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "SourceInvoiceId",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "ActualUnitCost",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "SupplierId",
                table: "InvoiceItems");
        }
    }
}
