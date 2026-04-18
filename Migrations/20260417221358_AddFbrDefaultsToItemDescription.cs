using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrDefaultsToItemDescription : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "FbrUOMId",
                table: "ItemDescriptions",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HSCode",
                table: "ItemDescriptions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SaleType",
                table: "ItemDescriptions",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UOM",
                table: "ItemDescriptions",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FbrUOMId",
                table: "ItemDescriptions");

            migrationBuilder.DropColumn(
                name: "HSCode",
                table: "ItemDescriptions");

            migrationBuilder.DropColumn(
                name: "SaleType",
                table: "ItemDescriptions");

            migrationBuilder.DropColumn(
                name: "UOM",
                table: "ItemDescriptions");
        }
    }
}
