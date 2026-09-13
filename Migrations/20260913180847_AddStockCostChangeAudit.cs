using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStockCostChangeAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "StockCostChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: false),
                    OpeningStockBalanceId = table.Column<int>(type: "int", nullable: true),
                    ChangedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ChangedByUserId = table.Column<int>(type: "int", nullable: true),
                    ChangedByUserName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Source = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: false),
                    SourceRef = table.Column<string>(type: "nvarchar(120)", maxLength: 120, nullable: true),
                    ImportRunId = table.Column<int>(type: "int", nullable: true),
                    ImportConsignmentId = table.Column<int>(type: "int", nullable: true),
                    OldQuantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false),
                    NewQuantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false),
                    OldActualCostExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    NewActualCostExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    OldValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    NewValueExcludingTax = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    Note = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockCostChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockCostChanges_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StockCostChanges_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockCostChanges_CompanyId_ItemTypeId_ChangedAt",
                table: "StockCostChanges",
                columns: new[] { "CompanyId", "ItemTypeId", "ChangedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StockCostChanges_ItemTypeId",
                table: "StockCostChanges",
                column: "ItemTypeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "StockCostChanges");
        }
    }
}
