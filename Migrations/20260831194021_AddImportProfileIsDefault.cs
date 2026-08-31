using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportProfileIsDefault : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsDefault",
                table: "ImportProfiles",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_ImportProfiles_Kind_IsDefault",
                table: "ImportProfiles",
                columns: new[] { "Kind", "IsDefault" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ImportProfiles_Kind_IsDefault",
                table: "ImportProfiles");

            migrationBuilder.DropColumn(
                name: "IsDefault",
                table: "ImportProfiles");
        }
    }
}
