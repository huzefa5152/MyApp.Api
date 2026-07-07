using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryV2Foundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "SalesOrders",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                defaultValue: "Open",
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldDefaultValue: "Open");

            migrationBuilder.AddColumn<int>(
                name: "SalesOrderId",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SalesOrderItemId",
                table: "InvoiceItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<byte>(
                name: "InventoryFlowVersion",
                table: "Companies",
                type: "tinyint",
                nullable: false,
                defaultValue: (byte)1);

            migrationBuilder.CreateTable(
                name: "CompanyItemTypeSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: false),
                    Mode = table.Column<byte>(type: "tinyint", nullable: false),
                    ReorderLevel = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CompanyItemTypeSettings", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CompanyItemTypeSettings_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_CompanyItemTypeSettings_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_Co_Date",
                table: "StockMovements",
                columns: new[] { "CompanyId", "MovementDate" });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_Co_Item_Date",
                table: "StockMovements",
                columns: new[] { "CompanyId", "ItemTypeId", "MovementDate", "Id" })
                .Annotation("SqlServer:Include", new[] { "Direction", "Quantity", "SourceType", "SourceId", "DivisionId" });

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_Co_Status",
                table: "SalesOrders",
                columns: new[] { "CompanyId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_SalesOrderId",
                table: "Invoices",
                column: "SalesOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_InvoiceItems_SalesOrderItemId",
                table: "InvoiceItems",
                column: "SalesOrderItemId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_Open",
                table: "GoodsReceipts",
                column: "CompanyId",
                filter: "[PurchaseBillId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_Open",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "SalesOrderId" },
                filter: "[InvoiceId] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CompanyItemTypeSettings_CompanyId_ItemTypeId",
                table: "CompanyItemTypeSettings",
                columns: new[] { "CompanyId", "ItemTypeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_CompanyItemTypeSettings_ItemTypeId",
                table: "CompanyItemTypeSettings",
                column: "ItemTypeId");

            migrationBuilder.AddForeignKey(
                name: "FK_InvoiceItems_SalesOrderItems_SalesOrderItemId",
                table: "InvoiceItems",
                column: "SalesOrderItemId",
                principalTable: "SalesOrderItems",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_SalesOrders_SalesOrderId",
                table: "Invoices",
                column: "SalesOrderId",
                principalTable: "SalesOrders",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_InvoiceItems_SalesOrderItems_SalesOrderItemId",
                table: "InvoiceItems");

            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_SalesOrders_SalesOrderId",
                table: "Invoices");

            migrationBuilder.DropTable(
                name: "CompanyItemTypeSettings");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_Co_Date",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_StockMovements_Co_Item_Date",
                table: "StockMovements");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrders_Co_Status",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_SalesOrderId",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_InvoiceItems_SalesOrderItemId",
                table: "InvoiceItems");

            migrationBuilder.DropIndex(
                name: "IX_GoodsReceipts_Open",
                table: "GoodsReceipts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_Open",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "SalesOrderId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "SalesOrderItemId",
                table: "InvoiceItems");

            migrationBuilder.DropColumn(
                name: "InventoryFlowVersion",
                table: "Companies");

            migrationBuilder.AlterColumn<string>(
                name: "Status",
                table: "SalesOrders",
                type: "nvarchar(max)",
                nullable: false,
                defaultValue: "Open",
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50,
                oldDefaultValue: "Open");
        }
    }
}
