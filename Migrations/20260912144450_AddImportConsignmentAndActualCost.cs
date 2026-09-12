using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportConsignmentAndActualCost : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ActualCostExcludingTax",
                table: "OpeningStockBalances",
                type: "decimal(18,2)",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateTable(
                name: "ImportConsignments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    GdNumber = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    GdDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    TotalCostExcludingTax = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalInputTax = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalIncomeTax = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    TotalSellingValue = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ImportRunId = table.Column<int>(type: "int", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportConsignments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportConsignments_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ImportConsignmentLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ImportConsignmentId = table.Column<int>(type: "int", nullable: false),
                    SourceRow = table.Column<int>(type: "int", nullable: false),
                    DescriptionOnSheet = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    HsCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    AssessedValue = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CustomsDuty = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Acd = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    RegulatoryDuty = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Others = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    SalesTaxRate = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    AstRate = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    IncomeTaxRate = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    AddOnProfit = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CostExcludingTax = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    SellingValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Disposition = table.Column<int>(type: "int", nullable: false),
                    DispositionNote = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    ItemTypeId = table.Column<int>(type: "int", nullable: true),
                    OpeningStockBalanceId = table.Column<int>(type: "int", nullable: true),
                    StockMovementId = table.Column<int>(type: "int", nullable: true),
                    ImportRunId = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ImportConsignmentLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ImportConsignmentLines_ImportConsignments_ImportConsignmentId",
                        column: x => x.ImportConsignmentId,
                        principalTable: "ImportConsignments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_ImportConsignmentLines_OpeningStockBalances_OpeningStockBalanceId",
                        column: x => x.OpeningStockBalanceId,
                        principalTable: "OpeningStockBalances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignmentLines_ImportConsignmentId",
                table: "ImportConsignmentLines",
                column: "ImportConsignmentId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignmentLines_ImportRunId",
                table: "ImportConsignmentLines",
                column: "ImportRunId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignmentLines_OpeningStockBalanceId",
                table: "ImportConsignmentLines",
                column: "OpeningStockBalanceId");

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignments_CompanyId_GdNumber",
                table: "ImportConsignments",
                columns: new[] { "CompanyId", "GdNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ImportConsignments_ImportRunId",
                table: "ImportConsignments",
                column: "ImportRunId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ImportConsignmentLines");

            migrationBuilder.DropTable(
                name: "ImportConsignments");

            migrationBuilder.DropColumn(
                name: "ActualCostExcludingTax",
                table: "OpeningStockBalances");
        }
    }
}
