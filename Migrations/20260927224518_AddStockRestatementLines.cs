using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStockRestatementLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StockRestatementLines",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: false),
                    StockMovementId = table.Column<int>(type: "int", nullable: false),
                    GdNumber = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    GdDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ClaimMonth = table.Column<DateTime>(type: "date", nullable: true),
                    SourceRow = table.Column<int>(type: "int", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    Quantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false),
                    ValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    ActualValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    SalesTaxRate = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    SourceFile = table.Column<string>(type: "nvarchar(260)", maxLength: 260, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockRestatementLines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockRestatementLines_StockMovements_StockMovementId",
                        column: x => x.StockMovementId,
                        principalTable: "StockMovements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockRestatementLines_CompanyId_ItemTypeId",
                table: "StockRestatementLines",
                columns: new[] { "CompanyId", "ItemTypeId" });

            migrationBuilder.CreateIndex(
                name: "IX_StockRestatementLines_StockMovementId",
                table: "StockRestatementLines",
                column: "StockMovementId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockRestatementLines");
        }
    }
}
