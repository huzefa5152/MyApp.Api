using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddContactPersonToClientAndSalesQuote : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContactPerson",
                table: "SalesQuotes",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactPerson",
                table: "Clients",
                type: "nvarchar(max)",
                nullable: true);

            // ParserFeedbacks CreateTable intentionally stripped — the table is
            // managed out-of-band and deliberately kept out of the model snapshot
            // (same guard as AddPaymentsAndReceipts / AddAttachmentAndFolderModule).
            // EF re-emits it on every scaffold; dropping it keeps this migration to
            // just the two intended ContactPerson columns.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContactPerson",
                table: "SalesQuotes");

            migrationBuilder.DropColumn(
                name: "ContactPerson",
                table: "Clients");
        }
    }
}
