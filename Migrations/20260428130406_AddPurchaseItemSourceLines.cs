using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseItemSourceLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PurchaseItemSourceLines",
                columns: table => new
                {
                    PurchaseItemId = table.Column<int>(type: "int", nullable: false),
                    InvoiceItemId = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseItemSourceLines", x => new { x.PurchaseItemId, x.InvoiceItemId });
                    table.ForeignKey(
                        name: "FK_PurchaseItemSourceLines_InvoiceItems_InvoiceItemId",
                        column: x => x.InvoiceItemId,
                        principalTable: "InvoiceItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PurchaseItemSourceLines_PurchaseItems_PurchaseItemId",
                        column: x => x.PurchaseItemId,
                        principalTable: "PurchaseItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItemSourceLines_InvoiceItemId",
                table: "PurchaseItemSourceLines",
                column: "InvoiceItemId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PurchaseItemSourceLines");
        }
    }
}
