using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class ItemTypeCompositeUniqueAndSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ItemTypes_Name",
                table: "ItemTypes");

            migrationBuilder.AlterColumn<string>(
                name: "HSCode",
                table: "ItemTypes",
                type: "nvarchar(450)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldNullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "ItemTypes",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_ItemTypes_Name_HSCode",
                table: "ItemTypes",
                columns: new[] { "Name", "HSCode" },
                unique: true,
                filter: "[IsDeleted] = 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ItemTypes_Name_HSCode",
                table: "ItemTypes");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "ItemTypes");

            migrationBuilder.AlterColumn<string>(
                name: "HSCode",
                table: "ItemTypes",
                type: "nvarchar(max)",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(450)",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ItemTypes_Name",
                table: "ItemTypes",
                column: "Name",
                unique: true);
        }
    }
}
