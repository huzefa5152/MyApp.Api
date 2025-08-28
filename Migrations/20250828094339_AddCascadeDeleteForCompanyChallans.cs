using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCascadeDeleteForCompanyChallans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Drop existing FK between DeliveryChallans and Companies
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Companies_CompanyId",
                table: "DeliveryChallans");

            // Re-add FK with cascade delete
            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Companies_CompanyId",
                table: "DeliveryChallans",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // Drop existing FK between DeliveryItems and DeliveryChallans
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_DeliveryChallans_DeliveryChallanId",
                table: "DeliveryItems");

            // Re-add FK with cascade delete
            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_DeliveryChallans_DeliveryChallanId",
                table: "DeliveryItems",
                column: "DeliveryChallanId",
                principalTable: "DeliveryChallans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Revert FK from DeliveryChallans to Companies
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Companies_CompanyId",
                table: "DeliveryChallans");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Companies_CompanyId",
                table: "DeliveryChallans",
                column: "CompanyId",
                principalTable: "Companies",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // Revert FK from DeliveryItems to DeliveryChallans
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_DeliveryChallans_DeliveryChallanId",
                table: "DeliveryItems");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_DeliveryChallans_DeliveryChallanId",
                table: "DeliveryItems",
                column: "DeliveryChallanId",
                principalTable: "DeliveryChallans",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
