using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportChargesUnitsLcs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BlNumber",
                table: "ImportConsignments",
                type: "nvarchar(60)",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ImportLcId",
                table: "ImportConsignments",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "ChargesAllocated",
                table: "ImportConsignmentLines",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<string>(
                name: "CustomsUnit",
                table: "CompanyItemTypeSettings",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CustomsUnitFactor",
                table: "CompanyItemTypeSettings",
                type: "decimal(18,6)",
                precision: 18,
                scale: 6,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ImportConsignmentCharges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ImportConsignmentId = table.Column<int>(type: "int", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    PaidTo = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    ChargeDate = table.Column<DateTime>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportConsignmentCharges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportConsignmentCharges_ImportConsignments_ImportConsignmentId",
                        column: x => x.ImportConsignmentId,
                        principalTable: "ImportConsignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ImportLetterOfCredits",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    LcNumber = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: false),
                    BankName = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    SupplierName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Currency = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    ForeignAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ExchangeRate = table.Column<decimal>(type: "decimal(18,6)", precision: 18, scale: 6, nullable: true),
                    OpenedOn = table.Column<DateTime>(type: "date", nullable: false),
                    ExpiresOn = table.Column<DateTime>(type: "date", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportLetterOfCredits", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportLetterOfCredits_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignments_ImportLcId",
                table: "ImportConsignments",
                column: "ImportLcId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignmentCharges_CompanyId",
                table: "ImportConsignmentCharges",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignmentCharges_ImportConsignmentId",
                table: "ImportConsignmentCharges",
                column: "ImportConsignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportLetterOfCredits_CompanyId_LcNumber",
                table: "ImportLetterOfCredits",
                columns: new[] { "CompanyId", "LcNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImportConsignmentCharges");

            migrationBuilder.DropTable(
                name: "ImportLetterOfCredits");

            migrationBuilder.DropIndex(
                name: "IX_ImportConsignments_ImportLcId",
                table: "ImportConsignments");

            migrationBuilder.DropColumn(
                name: "BlNumber",
                table: "ImportConsignments");

            migrationBuilder.DropColumn(
                name: "ImportLcId",
                table: "ImportConsignments");

            migrationBuilder.DropColumn(
                name: "ChargesAllocated",
                table: "ImportConsignmentLines");

            migrationBuilder.DropColumn(
                name: "CustomsUnit",
                table: "CompanyItemTypeSettings");

            migrationBuilder.DropColumn(
                name: "CustomsUnitFactor",
                table: "CompanyItemTypeSettings");
        }
    }
}
