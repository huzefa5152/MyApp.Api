using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceItemKeepInStock : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // An invoice filed by hand on FBR's portal may keep some HS codes in
            // stock (2026-10-28). Every existing line keeps its deduction.
            migrationBuilder.AddColumn<bool>(
                name: "KeepInStock",
                table: "InvoiceItems",
                type: "bit",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "KeepInStock",
                table: "InvoiceItems");
        }
    }
}
