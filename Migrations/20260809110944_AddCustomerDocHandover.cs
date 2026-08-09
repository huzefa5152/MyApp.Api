using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerDocHandover : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "HandoverAt",
                table: "Invoices",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HandoverByUserId",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HandoverRemark",
                table: "Invoices",
                type: "nvarchar(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_HandoverAt",
                table: "Invoices",
                columns: new[] { "CompanyId", "HandoverAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_HandoverByUserId",
                table: "Invoices",
                column: "HandoverByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_Users_HandoverByUserId",
                table: "Invoices",
                column: "HandoverByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_Users_HandoverByUserId",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_HandoverAt",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_HandoverByUserId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "HandoverAt",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "HandoverByUserId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "HandoverRemark",
                table: "Invoices");
        }
    }
}
