using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ClientGroupId",
                table: "POFormats",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ClientGroupId",
                table: "Clients",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ClientGroups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GroupKey = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    DisplayName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    NormalizedNtn = table.Column<string>(type: "nvarchar(450)", nullable: true),
                    NormalizedName = table.Column<string>(type: "nvarchar(450)", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ClientGroups", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_POFormats_ClientGroupId",
                table: "POFormats",
                column: "ClientGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_Clients_ClientGroupId",
                table: "Clients",
                column: "ClientGroupId");

            migrationBuilder.CreateIndex(
                name: "IX_ClientGroups_GroupKey",
                table: "ClientGroups",
                column: "GroupKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ClientGroups_NormalizedName",
                table: "ClientGroups",
                column: "NormalizedName");

            migrationBuilder.CreateIndex(
                name: "IX_ClientGroups_NormalizedNtn",
                table: "ClientGroups",
                column: "NormalizedNtn");

            migrationBuilder.AddForeignKey(
                name: "FK_Clients_ClientGroups_ClientGroupId",
                table: "Clients",
                column: "ClientGroupId",
                principalTable: "ClientGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_POFormats_ClientGroups_ClientGroupId",
                table: "POFormats",
                column: "ClientGroupId",
                principalTable: "ClientGroups",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Clients_ClientGroups_ClientGroupId",
                table: "Clients");

            migrationBuilder.DropForeignKey(
                name: "FK_POFormats_ClientGroups_ClientGroupId",
                table: "POFormats");

            migrationBuilder.DropTable(
                name: "ClientGroups");

            migrationBuilder.DropIndex(
                name: "IX_POFormats_ClientGroupId",
                table: "POFormats");

            migrationBuilder.DropIndex(
                name: "IX_Clients_ClientGroupId",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "ClientGroupId",
                table: "POFormats");

            migrationBuilder.DropColumn(
                name: "ClientGroupId",
                table: "Clients");
        }
    }
}
