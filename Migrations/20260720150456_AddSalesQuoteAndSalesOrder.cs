using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddSalesQuoteAndSalesOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SalesOrderItemId",
                table: "DeliveryItems",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SalesOrderId",
                table: "DeliveryChallans",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentSalesOrderNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CurrentSalesQuoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingSalesOrderNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingSalesQuoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "SalesOrderItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SalesOrderId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: true),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(max)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesOrderItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalesOrderItems_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SalesOrders",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    SalesOrderNumber = table.Column<int>(type: "int", nullable: false),
                    ClientId = table.Column<int>(type: "int", nullable: false),
                    OrderDate = table.Column<DateTime>(type: "datetime2", nullable: false),
                    RequiredDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CustomerPoNumber = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    CustomerPoDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Site = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Status = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false, defaultValue: "Open"),
                    SalesQuoteId = table.Column<int>(type: "int", nullable: true),
                    IsImported = table.Column<bool>(type: "bit", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesOrders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalesOrders_Clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "Clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SalesOrders_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SalesQuotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    QuoteNumber = table.Column<int>(type: "int", nullable: false),
                    ClientId = table.Column<int>(type: "int", nullable: false),
                    Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ValidUntil = table.Column<DateTime>(type: "datetime2", nullable: true),
                    CustomerEnquiryRef = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    EnquiryDate = table.Column<DateTime>(type: "datetime2", nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Subtotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GSTRate = table.Column<decimal>(type: "decimal(5,2)", precision: 5, scale: 2, nullable: false),
                    GSTAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GrandTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    AmountInWords = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(max)", nullable: false, defaultValue: "Draft"),
                    ConvertedToSalesOrderId = table.Column<int>(type: "int", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesQuotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalesQuotes_Clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "Clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SalesQuotes_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SalesQuotes_SalesOrders_ConvertedToSalesOrderId",
                        column: x => x.ConvertedToSalesOrderId,
                        principalTable: "SalesOrders",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "SalesQuoteItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SalesQuoteId = table.Column<int>(type: "int", nullable: false),
                    ItemTypeId = table.Column<int>(type: "int", nullable: true),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    Unit = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UnitPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    LineTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesQuoteItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalesQuoteItems_ItemTypes_ItemTypeId",
                        column: x => x.ItemTypeId,
                        principalTable: "ItemTypes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_SalesQuoteItems_SalesQuotes_SalesQuoteId",
                        column: x => x.SalesQuoteId,
                        principalTable: "SalesQuotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryItems_SalesOrderItemId",
                table: "DeliveryItems",
                column: "SalesOrderItemId");

            migrationBuilder.CreateIndex(
                name: "IX_DeliveryChallans_SalesOrderId",
                table: "DeliveryChallans",
                column: "SalesOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrderItems_ItemTypeId",
                table: "SalesOrderItems",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrderItems_SalesOrderId",
                table: "SalesOrderItems",
                column: "SalesOrderId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_ClientId",
                table: "SalesOrders",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_CompanyId_SalesOrderNumber",
                table: "SalesOrders",
                columns: new[] { "CompanyId", "SalesOrderNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesOrders_SalesQuoteId",
                table: "SalesOrders",
                column: "SalesQuoteId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuoteItems_ItemTypeId",
                table: "SalesQuoteItems",
                column: "ItemTypeId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuoteItems_SalesQuoteId",
                table: "SalesQuoteItems",
                column: "SalesQuoteId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_ClientId",
                table: "SalesQuotes",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_CompanyId_QuoteNumber",
                table: "SalesQuotes",
                columns: new[] { "CompanyId", "QuoteNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SalesQuotes_ConvertedToSalesOrderId",
                table: "SalesQuotes",
                column: "ConvertedToSalesOrderId");

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryChallans_SalesOrders_SalesOrderId",
                table: "DeliveryChallans",
                column: "SalesOrderId",
                principalTable: "SalesOrders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_DeliveryItems_SalesOrderItems_SalesOrderItemId",
                table: "DeliveryItems",
                column: "SalesOrderItemId",
                principalTable: "SalesOrderItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrderItems_SalesOrders_SalesOrderId",
                table: "SalesOrderItems",
                column: "SalesOrderId",
                principalTable: "SalesOrders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrders_SalesQuotes_SalesQuoteId",
                table: "SalesOrders",
                column: "SalesQuoteId",
                principalTable: "SalesQuotes",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryChallans_SalesOrders_SalesOrderId",
                table: "DeliveryChallans");

            migrationBuilder.DropForeignKey(
                name: "FK_DeliveryItems_SalesOrderItems_SalesOrderItemId",
                table: "DeliveryItems");

            migrationBuilder.DropForeignKey(
                name: "FK_SalesQuotes_SalesOrders_ConvertedToSalesOrderId",
                table: "SalesQuotes");

            migrationBuilder.DropTable(
                name: "SalesOrderItems");

            migrationBuilder.DropTable(
                name: "SalesQuoteItems");

            migrationBuilder.DropTable(
                name: "SalesOrders");

            migrationBuilder.DropTable(
                name: "SalesQuotes");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryItems_SalesOrderItemId",
                table: "DeliveryItems");

            migrationBuilder.DropIndex(
                name: "IX_DeliveryChallans_SalesOrderId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "SalesOrderItemId",
                table: "DeliveryItems");

            migrationBuilder.DropColumn(
                name: "SalesOrderId",
                table: "DeliveryChallans");

            migrationBuilder.DropColumn(
                name: "CurrentSalesOrderNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "CurrentSalesQuoteNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingSalesOrderNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingSalesQuoteNumber",
                table: "Companies");
        }
    }
}
