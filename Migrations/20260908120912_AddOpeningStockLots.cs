using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOpeningStockLots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OpeningStockLots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    OpeningStockBalanceId = table.Column<int>(type: "int", nullable: false),
                    SourceRow = table.Column<int>(type: "int", nullable: false),
                    ItemNameOnSheet = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    HsCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    LotRef = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    LotDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Unit = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    UnitPrice = table.Column<decimal>(type: "decimal(18,6)", nullable: true),
                    OpeningQuantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: true),
                    OpeningValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    OpeningSalesTaxRate = table.Column<decimal>(type: "decimal(5,2)", nullable: true),
                    ConsumedQuantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: true),
                    ConsumedValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    ConsumedSalesTaxRate = table.Column<decimal>(type: "decimal(5,2)", nullable: true),
                    BalanceQuantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false),
                    BalanceValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    BalanceSalesTaxRate = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    ImportRunId = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OpeningStockLots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OpeningStockLots_OpeningStockBalances_OpeningStockBalanceId",
                        column: x => x.OpeningStockBalanceId,
                        principalTable: "OpeningStockBalances",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OpeningStockLots_ImportRunId",
                table: "OpeningStockLots",
                column: "ImportRunId");

            migrationBuilder.CreateIndex(
                name: "IX_OpeningStockLots_OpeningStockBalanceId",
                table: "OpeningStockLots",
                column: "OpeningStockBalanceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OpeningStockLots");
        }
    }
}
