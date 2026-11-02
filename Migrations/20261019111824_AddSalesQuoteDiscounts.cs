using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSalesQuoteDiscounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "DiscountAmount",
                table: "SalesQuotes",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<bool>(
                name: "DiscountIsPercent",
                table: "SalesQuotes",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DiscountReason",
                table: "SalesQuotes",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountValue",
                table: "SalesQuotes",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountAmount",
                table: "SalesQuoteItems",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<bool>(
                name: "DiscountIsPercent",
                table: "SalesQuoteItems",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "DiscountReason",
                table: "SalesQuoteItems",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DiscountValue",
                table: "SalesQuoteItems",
                type: "decimal(18,4)",
                precision: 18,
                scale: 4,
                nullable: false,
                defaultValue: 0m);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DiscountAmount",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "DiscountIsPercent",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "DiscountReason",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "DiscountValue",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "DiscountAmount",
                table: "SalesQuoteItems");

            migrationBuilder.DropColumn(
                name: "DiscountIsPercent",
                table: "SalesQuoteItems");

            migrationBuilder.DropColumn(
                name: "DiscountReason",
                table: "SalesQuoteItems");

            migrationBuilder.DropColumn(
                name: "DiscountValue",
                table: "SalesQuoteItems");
        }
    }
}
