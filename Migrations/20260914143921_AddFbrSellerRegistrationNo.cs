using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFbrSellerRegistrationNo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "FbrSellerRegistrationNo",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            // Backfill the dedicated FBR seller identity from whatever each
            // company was already filing under: prefer the display CNIC, else
            // the display NTN. This keeps every existing FBR submission working
            // unchanged now that the seller identity is decoupled from the
            // display IDs. Wrapped in EXEC('') so the reference to the
            // just-added column is parsed at execution time, not batch parse
            // time (SQL Server would otherwise fail the whole batch — CLAUDE.md §11).
            migrationBuilder.Sql(
                "EXEC('UPDATE [Companies] SET [FbrSellerRegistrationNo] = " +
                "COALESCE(NULLIF(LTRIM(RTRIM([CNIC])), ''''), NULLIF(LTRIM(RTRIM([NTN])), '''')) " +
                "WHERE [FbrSellerRegistrationNo] IS NULL')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FbrSellerRegistrationNo",
                table: "Companies");
        }
    }
}
