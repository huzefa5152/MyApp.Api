using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddListOrderIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_List",
                table: "SalesQuotes",
                columns: new[] { "CompanyId", "QuoteNumber", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_List",
                table: "SalesOrders",
                columns: new[] { "CompanyId", "SalesOrderNumber", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_List",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "PurchaseBillNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_List",
                table: "Invoices",
                columns: new[] { "CompanyId", "IsDemo", "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_List",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "IsDemo", "CreatedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesQuotes_List",
                table: "SalesQuotes");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrders_List",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_List",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_List",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_List",
                table: "DeliveryChallans");
        }
    }
}
