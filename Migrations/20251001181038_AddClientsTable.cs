using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientsTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClientName",
                table: "DeliveryChallans");

            migrationBuilder.AddColumn<int>(
                name: "ClientId",
                table: "DeliveryChallans",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "Client",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Email = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Client", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_ClientId",
                table: "DeliveryChallans",
                column: "ClientId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Client_ClientId",
                table: "DeliveryChallans",
                column: "ClientId",
                principalTable: "Client",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Client_ClientId",
                table: "DeliveryChallans");

            migrationBuilder.DropTable(
                name: "Client");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_ClientId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "DeliveryChallans");

            migrationBuilder.AddColumn<string>(
                name: "ClientName",
                table: "DeliveryChallans",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "");
        }
    }
}
