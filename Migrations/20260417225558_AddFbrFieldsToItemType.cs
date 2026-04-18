using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrFieldsToItemType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FbrDescription",
                table: "ItemTypes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FbrUOMId",
                table: "ItemTypes",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HSCode",
                table: "ItemTypes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsFavorite",
                table: "ItemTypes",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "LastUsedAt",
                table: "ItemTypes",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SaleType",
                table: "ItemTypes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "UOM",
                table: "ItemTypes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UsageCount",
                table: "ItemTypes",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FbrDescription",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "FbrUOMId",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "HSCode",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "IsFavorite",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "LastUsedAt",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "SaleType",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "UOM",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "UsageCount",
                table: "ItemTypes");
        }
    }
}
