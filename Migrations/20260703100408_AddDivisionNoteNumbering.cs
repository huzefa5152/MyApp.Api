using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDivisionNoteNumbering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CurrentCreditNoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentDebitNoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingCreditNoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingDebitNoteNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CurrentCreditNoteNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentDebitNoteNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingCreditNoteNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingDebitNoteNumber",
                table: "Divisions");
        }
    }
}
