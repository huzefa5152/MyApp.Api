using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseAndInventoryModule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CurrentGoodsReceiptNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentPurchaseBillNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "InventoryTrackingEnabled",
                table: "Companies",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "StartingGoodsReceiptNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingPurchaseBillNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "StockGuardHardBlock",
                table: "Companies",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "OpeningStockBalances",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    AsOfDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OpeningStockBalances", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OpeningStockBalances_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OpeningStockBalances_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StockMovements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: false),
                    Direction = table.Column<int>(type: "int", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    SourceType = table.Column<int>(type: "int", nullable: false),
                    SourceId = table.Column<int>(type: "int", nullable: true),
                    MovementDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StockMovements", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StockMovements_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StockMovements_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Suppliers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Address = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Email = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    NTN = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    STRN = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    Site = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    RegistrationType = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    CNIC = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: true),
                    FbrProvinceCode = table.Column<int>(type: "int", nullable: true),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Suppliers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Suppliers_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseBills",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseBillNumber = table.Column<int>(type: "int", nullable: false),
                    Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    SupplierId = table.Column<int>(type: "int", nullable: false),
                    SupplierBillNumber = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    SupplierIRN = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    Subtotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GSTRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    GSTAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GrandTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    AmountInWords = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PaymentTerms = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    DocumentType = table.Column<int>(type: "int", nullable: true),
                    PaymentMode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    ReconciliationStatus = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "Pending"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseBills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseBills_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PurchaseBills_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GoodsReceipts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GoodsReceiptNumber = table.Column<int>(type: "int", nullable: false),
                    ReceiptDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    SupplierId = table.Column<int>(type: "int", nullable: false),
                    PurchaseBillId = table.Column<int>(type: "int", nullable: true),
                    SupplierChallanNumber = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Site = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false, defaultValue: "Pending"),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoodsReceipts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GoodsReceipts_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GoodsReceipts_PurchaseBills_PurchaseBillId",
                        column: x => x.PurchaseBillId,
                        principalTable: "PurchaseBills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_GoodsReceipts_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "GoodsReceiptItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    GoodsReceiptId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: true),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoodsReceiptItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_GoodsReceiptItems_GoodsReceipts_GoodsReceiptId",
                        column: x => x.GoodsReceiptId,
                        principalTable: "GoodsReceipts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_GoodsReceiptItems_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseBillId = table.Column<int>(type: "int", nullable: false),
                    GoodsReceiptItemId = table.Column<int>(type: "int", nullable: true),
                    ItemTypeId = table.Column<int>(type: "int", nullable: true),
                    ItemTypeName = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<int>(type: "int", nullable: false),
                    UOM = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    LineTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    HSCode = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    FbrUOMId = table.Column<int>(type: "int", nullable: true),
                    SaleType = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    RateId = table.Column<int>(type: "int", nullable: true),
                    FixedNotifiedValueOrRetailPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: true),
                    SroScheduleNo = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    SroItemSerialNo = table.Column<string>(type: "nvarchar(max)", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseItems_GoodsReceiptItems_GoodsReceiptItemId",
                        column: x => x.GoodsReceiptItemId,
                        principalTable: "GoodsReceiptItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_PurchaseItems_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PurchaseItems_PurchaseBills_PurchaseBillId",
                        column: x => x.PurchaseBillId,
                        principalTable: "PurchaseBills",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceiptItems_GoodsReceiptId",
                table: "GoodsReceiptItems",
                column: "GoodsReceiptId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceiptItems_ItemTypeId",
                table: "GoodsReceiptItems",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_CompanyId",
                table: "GoodsReceipts",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_CompanyId_GoodsReceiptNumber",
                table: "GoodsReceipts",
                columns: new[] { "CompanyId", "GoodsReceiptNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_PurchaseBillId",
                table: "GoodsReceipts",
                column: "PurchaseBillId");

            migrationBuilder.CreateIndex(
                name: "IX_GoodsReceipts_SupplierId",
                table: "GoodsReceipts",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_OpeningStockBalances_CompanyId_ItemTypeId",
                table: "OpeningStockBalances",
                columns: new[] { "CompanyId", "ItemTypeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OpeningStockBalances_ItemTypeId",
                table: "OpeningStockBalances",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId",
                table: "PurchaseBills",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_CompanyId_PurchaseBillNumber",
                table: "PurchaseBills",
                columns: new[] { "CompanyId", "PurchaseBillNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_SupplierId",
                table: "PurchaseBills",
                column: "SupplierId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseBills_SupplierIRN",
                table: "PurchaseBills",
                column: "SupplierIRN");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_GoodsReceiptItemId",
                table: "PurchaseItems",
                column: "GoodsReceiptItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_ItemTypeId",
                table: "PurchaseItems",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItems_PurchaseBillId",
                table: "PurchaseItems",
                column: "PurchaseBillId");

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_CompanyId_ItemTypeId",
                table: "StockMovements",
                columns: new[] { "CompanyId", "ItemTypeId" });

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_ItemTypeId",
                table: "StockMovements",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_StockMovements_SourceType_SourceId",
                table: "StockMovements",
                columns: new[] { "SourceType", "SourceId" });

            migrationBuilder.CreateIndex(
                name: "IX_Suppliers_CompanyId",
                table: "Suppliers",
                column: "CompanyId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OpeningStockBalances");

            migrationBuilder.DropTable(
                name: "PurchaseItems");

            migrationBuilder.DropTable(
                name: "StockMovements");

            migrationBuilder.DropTable(
                name: "GoodsReceiptItems");

            migrationBuilder.DropTable(
                name: "GoodsReceipts");

            migrationBuilder.DropTable(
                name: "PurchaseBills");

            migrationBuilder.DropTable(
                name: "Suppliers");

            migrationBuilder.DropColumn(
                name: "CurrentGoodsReceiptNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "CurrentPurchaseBillNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "InventoryTrackingEnabled",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingGoodsReceiptNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingPurchaseBillNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StockGuardHardBlock",
                table: "Companies");
        }
    }
}
