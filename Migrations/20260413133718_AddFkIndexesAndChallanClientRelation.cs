using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddFkIndexesAndChallanClientRelation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Clients_ClientId",
                table: "DeliveryChallans");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Clients_ClientId",
                table: "DeliveryChallans",
                column: "ClientId",
                principalTable: "Clients",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Clients_ClientId",
                table: "DeliveryChallans");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Clients_ClientId",
                table: "DeliveryChallans",
                column: "ClientId",
                principalTable: "Clients",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
