using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPaymentAllocationAdjustment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AdjustmentAccountId",
                table: "PaymentAllocations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AdjustmentAmount",
                table: "PaymentAllocations",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_AdjustmentAccountId",
                table: "PaymentAllocations",
                column: "AdjustmentAccountId");

            migrationBuilder.AddForeignKey(
                name: "FK_PaymentAllocations_Accounts_AdjustmentAccountId",
                table: "PaymentAllocations",
                column: "AdjustmentAccountId",
                principalTable: "Accounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PaymentAllocations_Accounts_AdjustmentAccountId",
                table: "PaymentAllocations");

            migrationBuilder.DropIndex(
                name: "IX_PaymentAllocations_AdjustmentAccountId",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "AdjustmentAccountId",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "AdjustmentAmount",
                table: "PaymentAllocations");
        }
    }
}
