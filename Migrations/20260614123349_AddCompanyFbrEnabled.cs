using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCompanyFbrEnabled : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Backfill existing companies to TRUE so live FBR tenants
            // (Hakimi / Roshan) keep working unchanged. New companies set the
            // value explicitly via CreateAsync (EF sends the actual bool), so
            // this DB default never silently overrides an operator's "off".
            migrationBuilder.AddColumn<bool>(
                name: "FbrEnabled",
                table: "Companies",
                type: "bit",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "FbrEnabled",
                table: "Companies");
        }
    }
}
