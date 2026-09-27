using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLineClaimMonth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ClaimMonth",
                table: "OpeningStockLots",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ClaimMonth",
                table: "ImportConsignmentLines",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClaimMonth",
                table: "OpeningStockLots");

            migrationBuilder.DropColumn(
                name: "ClaimMonth",
                table: "ImportConsignmentLines");
        }
    }
}
