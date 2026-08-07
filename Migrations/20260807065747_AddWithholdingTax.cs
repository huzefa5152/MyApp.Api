using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWithholdingTax : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "WithholdingTaxAmount",
                table: "PurchaseBills",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "WithholdingTaxRate",
                table: "PurchaseBills",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "WithholdingTaxAmount",
                table: "Invoices",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "WithholdingTaxRate",
                table: "Invoices",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DefaultWithholdingTaxRate",
                table: "Companies",
                type: "decimal(5,2)",
                precision: 5,
                scale: 2,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "WithholdingTaxAmount",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "WithholdingTaxRate",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "WithholdingTaxAmount",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "WithholdingTaxRate",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "DefaultWithholdingTaxRate",
                table: "Companies");
        }
    }
}
