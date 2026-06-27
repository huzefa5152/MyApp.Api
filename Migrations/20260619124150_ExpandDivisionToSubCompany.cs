using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class ExpandDivisionToSubCompany : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesQuotes_CompanyId_QuoteNumber",
                table: "SalesQuotes");

            migrationBuilder.AddColumn<string>(
                name: "BrandName",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CNIC",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentSalesQuoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "FullAddress",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LogoPath",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NTN",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "STRN",
                table: "Divisions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "StartingSalesQuoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_CompanyId_DivisionId_QuoteNumber",
                table: "SalesQuotes",
                columns: new[] { "CompanyId", "DivisionId", "QuoteNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesQuotes_CompanyId_DivisionId_QuoteNumber",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "BrandName",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CNIC",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentSalesQuoteNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "FullAddress",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "LogoPath",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "NTN",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "Phone",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "STRN",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingSalesQuoteNumber",
                table: "Divisions");

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_CompanyId_QuoteNumber",
                table: "SalesQuotes",
                columns: new[] { "CompanyId", "QuoteNumber" },
                unique: true);
        }
    }
}
