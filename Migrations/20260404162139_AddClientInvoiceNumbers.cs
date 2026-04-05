using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddClientInvoiceNumbers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'StartingInvoiceNumber')
                    ALTER TABLE Clients ADD StartingInvoiceNumber int NOT NULL DEFAULT 0;
                IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'CurrentInvoiceNumber')
                    ALTER TABLE Clients ADD CurrentInvoiceNumber int NOT NULL DEFAULT 0;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrentInvoiceNumber",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "StartingInvoiceNumber",
                table: "Clients");
        }
    }
}
