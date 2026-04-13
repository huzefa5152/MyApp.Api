using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class FbrDigitalInvoicingFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DocumentType",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrErrorMessage",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrIRN",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrInvoiceNumber",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrStatus",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FbrSubmittedAt",
                table: "Invoices",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PaymentMode",
                table: "Invoices",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FbrUOMId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HSCode",
                table: "InvoiceItems",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RateId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SaleType",
                table: "InvoiceItems",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrBusinessActivity",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrEnvironment",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FbrProvinceCode",
                table: "Companies",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrSector",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FbrToken",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InvoiceNumberPrefix",
                table: "Companies",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CNIC",
                table: "Clients",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FbrProvinceCode",
                table: "Clients",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RegistrationType",
                table: "Clients",
                type: "nvarchar(max)",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DocumentType",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrErrorMessage",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrIRN",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrInvoiceNumber",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrStatus",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrSubmittedAt",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "PaymentMode",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "FbrUOMId",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "HSCode",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "RateId",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "SaleType",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "FbrBusinessActivity",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrEnvironment",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrProvinceCode",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrSector",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "FbrToken",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "InvoiceNumberPrefix",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "CNIC",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "FbrProvinceCode",
                table: "Clients");

            migrationBuilder.DropColumn(
                name: "RegistrationType",
                table: "Clients");
        }
    }
}
