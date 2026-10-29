using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class CompanyNonFbrBilling : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TaxTreatment",
                table: "Invoices",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "FBR");

            migrationBuilder.AddColumn<bool>(
                name: "AllowNonFbrBills",
                table: "Companies",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TaxTreatment",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "AllowNonFbrBills",
                table: "Companies");
        }
    }
}
