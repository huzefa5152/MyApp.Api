using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseDebitNotes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PurchaseDebitNotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    DebitNoteNumber = table.Column<int>(type: "int", nullable: false),
                    Date = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CompanyId = table.Column<int>(type: "int", nullable: false),
                    DivisionId = table.Column<int>(type: "int", nullable: true),
                    SupplierId = table.Column<int>(type: "int", nullable: false),
                    SupplierRef = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    Notes = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Subtotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GSTAmount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    GrandTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    IsMigrated = table.Column<bool>(type: "bit", nullable: false),
                    ExternalRef = table.Column<string>(type: "nvarchar(60)", maxLength: 60, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseDebitNotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseDebitNotes_Companies_CompanyId",
                        column: x => x.CompanyId,
                        principalTable: "Companies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_PurchaseDebitNotes_Divisions_DivisionId",
                        column: x => x.DivisionId,
                        principalTable: "Divisions",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PurchaseDebitNotes_Suppliers_SupplierId",
                        column: x => x.SupplierId,
                        principalTable: "Suppliers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "PurchaseDebitNoteItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseDebitNoteId = table.Column<int>(type: "int", nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Quantity = table.Column<decimal>(type: "decimal(18,4)", precision: 18, scale: 4, nullable: false),
                    UOM = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    UnitPrice = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    LineTotal = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseDebitNoteItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PurchaseDebitNoteItems_PurchaseDebitNotes_PurchaseDebitNoteId",
                        column: x => x.PurchaseDebitNoteId,
                        principalTable: "PurchaseDebitNotes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNoteItems_PurchaseDebitNoteId",
                table: "PurchaseDebitNoteItems",
                column: "PurchaseDebitNoteId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_CompanyId",
                table: "PurchaseDebitNotes",
                column: "CompanyId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_CompanyId_DivisionId_DebitNoteNumber",
                table: "PurchaseDebitNotes",
                columns: new[] { "CompanyId", "DivisionId", "DebitNoteNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_CompanyId_ExternalRef",
                table: "PurchaseDebitNotes",
                columns: new[] { "CompanyId", "ExternalRef" });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_DivisionId",
                table: "PurchaseDebitNotes",
                column: "DivisionId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseDebitNotes_SupplierId",
                table: "PurchaseDebitNotes",
                column: "SupplierId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PurchaseDebitNoteItems");

            migrationBuilder.DropTable(
                name: "PurchaseDebitNotes");
        }
    }
}
