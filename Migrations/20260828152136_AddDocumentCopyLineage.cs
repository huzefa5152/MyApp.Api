using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDocumentCopyLineage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "SalesQuotes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "SalesQuotes",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "SalesOrders",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "SalesOrders",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "PurchaseBills",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "PurchaseBills",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "Invoices",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "GoodsReceipts",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "GoodsReceipts",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CopiedFromId",
                table: "DeliveryChallans",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CopiedFromType",
                table: "DeliveryChallans",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "SalesOrders");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "SalesOrders");

            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "GoodsReceipts");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "GoodsReceipts");

            migrationBuilder.DropColumn(
                name: "CopiedFromId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "CopiedFromType",
                table: "DeliveryChallans");
        }
    }
}
