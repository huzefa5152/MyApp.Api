using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddPurchaseItemSources : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PurchaseItemSources",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PurchaseItemId = table.Column<int>(type: "int", nullable: false),
                    SalesOrderItemId = table.Column<int>(type: "int", nullable: true),
                    DeliveryItemId = table.Column<int>(type: "int", nullable: true),
                    InvoiceItemId = table.Column<int>(type: "int", nullable: true),
                    Quantity = table.Column<decimal>(type: "decimal(28,12)", precision: 28, scale: 12, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PurchaseItemSources", x => x.Id);
                    table.CheckConstraint("CK_PurchaseItemSources_OneLine", "(CASE WHEN [SalesOrderItemId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [DeliveryItemId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [InvoiceItemId] IS NULL THEN 0 ELSE 1 END) = 1");
                    table.ForeignKey(
                        name: "FK_PurchaseItemSources_DeliveryItems_DeliveryItemId",
                        column: x => x.DeliveryItemId,
                        principalTable: "DeliveryItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PurchaseItemSources_InvoiceItems_InvoiceItemId",
                        column: x => x.InvoiceItemId,
                        principalTable: "InvoiceItems",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_PurchaseItemSources_PurchaseItems_PurchaseItemId",
                        column: x => x.PurchaseItemId,
                        principalTable: "PurchaseItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PurchaseItemSources_SalesOrderItems_SalesOrderItemId",
                        column: x => x.SalesOrderItemId,
                        principalTable: "SalesOrderItems",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItemSources_DeliveryItemId",
                table: "PurchaseItemSources",
                column: "DeliveryItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItemSources_InvoiceItemId",
                table: "PurchaseItemSources",
                column: "InvoiceItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItemSources_PurchaseItemId",
                table: "PurchaseItemSources",
                column: "PurchaseItemId");

            migrationBuilder.CreateIndex(
                name: "IX_PurchaseItemSources_SalesOrderItemId",
                table: "PurchaseItemSources",
                column: "SalesOrderItemId");

            // Carry the sale-bill purchase links over. A legacy row could cover
            // several bill lines (grouped by item type); its quantity is split
            // across them in proportion to each bill line's quantity.
            // PurchaseItemSourceLines itself is left untouched.
            migrationBuilder.Sql(@"
INSERT INTO PurchaseItemSources (PurchaseItemId, InvoiceItemId, Quantity)
SELECT sl.PurchaseItemId, sl.InvoiceItemId,
       CAST(pi.Quantity * ii.Quantity / t.Total AS decimal(28,12))
FROM PurchaseItemSourceLines sl
JOIN PurchaseItems pi ON pi.Id = sl.PurchaseItemId
JOIN InvoiceItems ii ON ii.Id = sl.InvoiceItemId
JOIN (SELECT s.PurchaseItemId, SUM(i.Quantity) AS Total
      FROM PurchaseItemSourceLines s JOIN InvoiceItems i ON i.Id = s.InvoiceItemId
      GROUP BY s.PurchaseItemId) t ON t.PurchaseItemId = sl.PurchaseItemId
WHERE t.Total > 0;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PurchaseItemSources");
        }
    }
}
