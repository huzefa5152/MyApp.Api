using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrDefaultsToCompany : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FbrDefaultPaymentModeRegistered",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrDefaultPaymentModeUnregistered",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrDefaultSaleType",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrDefaultUOM",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FbrDefaultPaymentModeRegistered",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrDefaultPaymentModeUnregistered",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrDefaultSaleType",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrDefaultUOM",
                table: "Companies");
        }
    }
}
