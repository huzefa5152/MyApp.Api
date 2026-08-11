using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoicePrintGroupingFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "PrintGroupBillByItemType",
                table: "Invoices",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "PrintGroupTaxInvoiceByItemType",
                table: "Invoices",
                type: "bit",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PrintGroupBillByItemType",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "PrintGroupTaxInvoiceByItemType",
                table: "Invoices");
        }
    }
}
