using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddAttachmentDivisionId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "Attachments",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Attachments_DivisionId",
                table: "Attachments",
                column: "DivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_Attachments_Divisions_DivisionId",
                table: "Attachments",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Attachments_Divisions_DivisionId",
                table: "Attachments");

            migrationBuilder.DropIndex(
                name: "IX_Attachments_DivisionId",
                table: "Attachments");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "Attachments");
        }
    }
}
