using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseDocumentsFrom : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PurchaseDocumentsFrom",
                table: "Companies",
                type: "datetime2",
                nullable: true);

            // Existing companies start from the day this ships: their older
            // documents were bought (or not) before purchases recorded which
            // customer lines they serve, so the picker cannot tell and must not
            // offer them. A company can move the date in its settings.
            migrationBuilder.Sql("EXEC('UPDATE Companies SET PurchaseDocumentsFrom = CAST(GETDATE() AS date)')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PurchaseDocumentsFrom",
                table: "Companies");
        }
    }
}
