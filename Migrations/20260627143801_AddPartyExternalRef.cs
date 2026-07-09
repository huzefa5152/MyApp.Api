using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPartyExternalRef : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Clients_CompanyId",
                table: "Clients");

            migrationBuilder.AddColumn<string>(
                name: "ExternalRef",
                table: "Suppliers",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalRef",
                table: "Clients",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_CompanyId_ExternalRef",
                table: "Suppliers",
                columns: new[] { "CompanyId", "ExternalRef" });

            migrationBuilder.CreateIndex(
                name: "IX_Clients_CompanyId_ExternalRef",
                table: "Clients",
                columns: new[] { "CompanyId", "ExternalRef" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Suppliers_CompanyId_ExternalRef",
                table: "Suppliers");

            migrationBuilder.DropIndex(
                name: "IX_Clients_CompanyId_ExternalRef",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "ExternalRef",
                table: "Suppliers");

            migrationBuilder.DropColumn(
                name: "ExternalRef",
                table: "Clients");

            migrationBuilder.CreateIndex(
                name: "IX_Clients_CompanyId",
                table: "Clients",
                column: "CompanyId");
        }
    }
}
