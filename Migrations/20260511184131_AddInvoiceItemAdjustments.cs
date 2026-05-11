using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInvoiceItemAdjustments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InvoiceItemAdjustments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    InvoiceItemId = table.Column<int>(type: "int", nullable: false),
                    InvoiceId = table.Column<int>(type: "int", nullable: false),
                    AdjustedQuantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: true),
                    AdjustedUnitPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    AdjustedLineTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    AdjustedItemTypeId = table.Column<int>(type: "int", nullable: true),
                    AdjustedItemTypeName = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    AdjustedDescription = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    AdjustedUOM = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: true),
                    AdjustedFbrUOMId = table.Column<int>(type: "int", nullable: true),
                    AdjustedHSCode = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    AdjustedSaleType = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false, defaultValue: "tax-claim-optimization"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    InvoiceItemId1 = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InvoiceItemAdjustments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InvoiceItemAdjustments_InvoiceItems_InvoiceItemId",
                        column: x => x.InvoiceItemId,
                        principalTable: "InvoiceItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_InvoiceItemAdjustments_InvoiceItems_InvoiceItemId1",
                        column: x => x.InvoiceItemId1,
                        principalTable: "InvoiceItems",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItemAdjustments_InvoiceId",
                table: "InvoiceItemAdjustments",
                column: "InvoiceId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItemAdjustments_InvoiceItemId",
                table: "InvoiceItemAdjustments",
                column: "InvoiceItemId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItemAdjustments_InvoiceItemId1",
                table: "InvoiceItemAdjustments",
                column: "InvoiceItemId1",
                unique: true,
                filter: "[InvoiceItemId1] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InvoiceItemAdjustments");
        }
    }
}
