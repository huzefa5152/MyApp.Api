using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddDivisionToDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SalesOrders_CompanyId_SalesOrderNumber",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_CompanyId_PurchaseBillNumber",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_InvoiceNumber",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_GoodsReceipts_CompanyId_GoodsReceiptNumber",
                table: "GoodsReceipts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_CompanyId_ChallanNumber",
                table: "DeliveryChallans");

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "SalesOrders",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "PurchaseBills",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "Invoices",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "GoodsReceipts",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentChallanNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentGoodsReceiptNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentInvoiceNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentPurchaseBillNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentSalesOrderNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingChallanNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingGoodsReceiptNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingInvoiceNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingPurchaseBillNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingSalesOrderNumber",
                table: "Divisions",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "DivisionId",
                table: "DeliveryChallans",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_CompanyId_DivisionId_SalesOrderNumber",
                table: "SalesOrders",
                columns: new[] { "CompanyId", "DivisionId", "SalesOrderNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_DivisionId",
                table: "SalesOrders",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId_DivisionId_PurchaseBillNumber",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "DivisionId", "PurchaseBillNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_DivisionId",
                table: "PurchaseBills",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_DivisionId_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "DivisionId", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_DivisionId",
                table: "Invoices",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_CompanyId_DivisionId_GoodsReceiptNumber",
                table: "GoodsReceipts",
                columns: new[] { "CompanyId", "DivisionId", "GoodsReceiptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_DivisionId",
                table: "GoodsReceipts",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_CompanyId_DivisionId_ChallanNumber",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "DivisionId", "ChallanNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_DivisionId",
                table: "DeliveryChallans",
                column: "DivisionId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_Divisions_DivisionId",
                table: "DeliveryChallans",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_GoodsReceipts_Divisions_DivisionId",
                table: "GoodsReceipts",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_Divisions_DivisionId",
                table: "Invoices",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseBills_Divisions_DivisionId",
                table: "PurchaseBills",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrders_Divisions_DivisionId",
                table: "SalesOrders",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_Divisions_DivisionId",
                table: "DeliveryChallans");

            migrationBuilder.DropForeignKey(
                name: "FK_GoodsReceipts_Divisions_DivisionId",
                table: "GoodsReceipts");

            migrationBuilder.DropForeignKey(
                name: "FK_Invoices_Divisions_DivisionId",
                table: "Invoices");

            migrationBuilder.DropForeignKey(
                name: "FK_PurchaseBills_Divisions_DivisionId",
                table: "PurchaseBills");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesOrders_Divisions_DivisionId",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrders_CompanyId_DivisionId_SalesOrderNumber",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_SalesOrders_DivisionId",
                table: "SalesOrders");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_CompanyId_DivisionId_PurchaseBillNumber",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_PurchaseBills_DivisionId",
                table: "PurchaseBills");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_DivisionId_InvoiceNumber",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_DivisionId",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_GoodsReceipts_CompanyId_DivisionId_GoodsReceiptNumber",
                table: "GoodsReceipts");

            migrationBuilder.DropIndex(
                name: "IX_GoodsReceipts_DivisionId",
                table: "GoodsReceipts");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_CompanyId_DivisionId_ChallanNumber",
                table: "DeliveryChallans");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_DivisionId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "SalesOrders");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "PurchaseBills");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "GoodsReceipts");

            migrationBuilder.DropColumn(
                name: "CurrentChallanNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentGoodsReceiptNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentInvoiceNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentPurchaseBillNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "CurrentSalesOrderNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingChallanNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingGoodsReceiptNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingInvoiceNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingPurchaseBillNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "StartingSalesOrderNumber",
                table: "Divisions");

            migrationBuilder.DropColumn(
                name: "DivisionId",
                table: "DeliveryChallans");

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_CompanyId_SalesOrderNumber",
                table: "SalesOrders",
                columns: new[] { "CompanyId", "SalesOrderNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId_PurchaseBillNumber",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "PurchaseBillNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_CompanyId_GoodsReceiptNumber",
                table: "GoodsReceipts",
                columns: new[] { "CompanyId", "GoodsReceiptNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_CompanyId_ChallanNumber",
                table: "DeliveryChallans",
                columns: new[] { "CompanyId", "ChallanNumber" });
        }
    }
}
