using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDuplicatedFromIdToDeliveryChallan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DuplicatedFromId",
                table: "DeliveryChallans",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans",
                column: "DuplicatedFromId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans",
                column: "DuplicatedFromId",
                principalTable: "DeliveryChallans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_DuplicatedFromId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "DuplicatedFromId",
                table: "DeliveryChallans");
        }
    }
}
