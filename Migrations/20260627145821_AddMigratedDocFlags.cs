using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddMigratedDocFlags : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExternalRef",
                table: "PurchaseBills",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsMigrated",
                table: "PurchaseBills",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "ExternalRef",
                table: "Invoices",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsMigrated",
                table: "Invoices",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId_ExternalRef",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "ExternalRef" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_ExternalRef",
                table: "Invoices",
                columns: new[] { "CompanyId", "ExternalRef" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_CompanyId_ExternalRef",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_ExternalRef",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "ExternalRef",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "IsMigrated",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "ExternalRef",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "IsMigrated",
                table: "Invoices");
        }
    }
}
