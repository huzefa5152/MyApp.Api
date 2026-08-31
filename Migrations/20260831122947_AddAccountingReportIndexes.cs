using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountingReportIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Payments_CompanyId_Direction_Date",
                table: "Payments",
                columns: new[] { "CompanyId", "Direction", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_Kind_AccountId",
                table: "PaymentAllocations",
                columns: new[] { "Kind", "AccountId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Payments_CompanyId_Direction_Date",
                table: "Payments");

            migrationBuilder.DropIndex(
                name: "IX_PaymentAllocations_Kind_AccountId",
                table: "PaymentAllocations");
        }
    }
}
