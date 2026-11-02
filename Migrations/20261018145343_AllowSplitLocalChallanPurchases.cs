using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AllowSplitLocalChallanPurchases : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalInvoiceItemId",
                table: "PurchaseItems");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_LocalDeliveryItemId",
                table: "PurchaseItems",
                column: "LocalDeliveryItemId",
                filter: "[LocalDeliveryItemId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_LocalInvoiceItemId",
                table: "PurchaseItems",
                column: "LocalInvoiceItemId",
                filter: "[LocalInvoiceItemId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("IF EXISTS (SELECT LocalDeliveryItemId FROM PurchaseItems WHERE LocalDeliveryItemId IS NOT NULL GROUP BY LocalDeliveryItemId HAVING COUNT(*) > 1) OR EXISTS (SELECT LocalInvoiceItemId FROM PurchaseItems WHERE LocalInvoiceItemId IS NOT NULL GROUP BY LocalInvoiceItemId HAVING COUNT(*) > 1) THROW 51000, 'Cannot roll back split local purchases while a source line has multiple purchase allocations.', 1;");
            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalDeliveryItemId",
                table: "PurchaseItems");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseItems_LocalInvoiceItemId",
                table: "PurchaseItems");

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
        }
    }
}
