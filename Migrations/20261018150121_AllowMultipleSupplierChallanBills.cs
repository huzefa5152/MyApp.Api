using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AllowMultipleSupplierChallanBills : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills",
                columns: new[] { "SourceDeliveryChallanId", "SupplierId" },
                filter: "[SourceDeliveryChallanId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_SourceDeliveryChallanId_SupplierId",
                table: "PurchaseBills",
                columns: new[] { "SourceDeliveryChallanId", "SupplierId" },
                unique: true,
                filter: "[SourceDeliveryChallanId] IS NOT NULL");
        }
    }
}
