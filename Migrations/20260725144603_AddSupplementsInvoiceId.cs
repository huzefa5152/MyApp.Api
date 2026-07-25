using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSupplementsInvoiceId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SupplementsInvoiceId",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_SupplementsInvoiceId",
                table: "Invoices",
                column: "SupplementsInvoiceId");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_Invoices_SupplementsInvoiceId",
                table: "Invoices",
                column: "SupplementsInvoiceId",
                principalTable: "Invoices",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_Invoices_SupplementsInvoiceId",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_SupplementsInvoiceId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "SupplementsInvoiceId",
                table: "Invoices");
        }
    }
}
