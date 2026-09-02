using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceAdvanceTax : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "AdvanceTaxAmount",
                table: "Invoices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<bool>(
                name: "AdvanceTaxFilerActive",
                table: "Invoices",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AdvanceTaxRate",
                table: "Invoices",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdvanceTaxSection",
                table: "Invoices",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AdvanceTaxAmount",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AdvanceTaxFilerActive",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AdvanceTaxRate",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AdvanceTaxSection",
                table: "Invoices");
        }
    }
}
