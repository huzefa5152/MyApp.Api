using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDateRangeIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId_Date",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_Payments_CompanyId_Date",
                table: "Payments",
                columns: new[] { "CompanyId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_Date",
                table: "Invoices",
                columns: new[] { "CompanyId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_CompanyId_DeliveryDate",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "DeliveryDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_CompanyId_Date",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_Payments_CompanyId_Date",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_Date",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_CompanyId_DeliveryDate",
                table: "DeliveryChallans");
        }
    }
}
