using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientIdToPOFormat : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ClientId",
                table: "POFormats",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_POFormats_ClientId",
                table: "POFormats",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_POFormats_CompanyId_ClientId",
                table: "POFormats",
                columns: new[] { "CompanyId", "ClientId" });

            migrationBuilder.AddForeignKey(
                name: "FK_POFormats_Clients_ClientId",
                table: "POFormats",
                column: "ClientId",
                principalTable: "Clients",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_POFormats_Clients_ClientId",
                table: "POFormats");

            migrationBuilder.DropIndex(
                name: "IX_POFormats_ClientId",
                table: "POFormats");

            migrationBuilder.DropIndex(
                name: "IX_POFormats_CompanyId_ClientId",
                table: "POFormats");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "POFormats");
        }
    }
}
