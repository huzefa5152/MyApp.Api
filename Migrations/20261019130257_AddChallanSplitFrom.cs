using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddChallanSplitFrom : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SplitFromChallanId",
                table: "DeliveryChallans",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_SplitFromChallanId",
                table: "DeliveryChallans",
                column: "SplitFromChallanId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_SplitFromChallanId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "SplitFromChallanId",
                table: "DeliveryChallans");
        }
    }
}
