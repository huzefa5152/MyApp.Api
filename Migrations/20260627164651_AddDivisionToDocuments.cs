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

            // MERGED 2026-07-03: both this migration and the note-numbering
            // migration on the other branch drop this index — whichever runs
            // second on a given database must tolerate it already being gone.
            migrationBuilder.Sql(@"IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_InvoiceNumber' AND object_id = OBJECT_ID('Invoices')) DROP INDEX [IX_Invoices_CompanyId_InvoiceNumber] ON [Invoices];");

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

            // MERGED 2026-07-03: on databases that took MASTER's note-split
            // migrations first (prod), credit/debit notes were renumbered into
            // per-kind sequences — a CN and a DN legally share a number, and a
            // note may share a number with a sale bill (uniqueness there is
            // scoped by NoteKind / IsReturnNote). A note-kind-blind unique
            // index would fail to CREATE on that data and abort AutoMigrate at
            // startup. Include the note-kind column when one exists; the plain
            // shape only ever runs on DBs that predate the note split (fresh
            // replays), where SyncNoteAndDivisionNumbering later normalises
            // the final shape. Index NAME is identical in all three branches
            // so the later IF EXISTS drop keeps working. NoteKind/IsReturnNote
            // references live inside EXEC so this batch parses on DBs where
            // those columns don't exist yet (CLAUDE.md §11).
            migrationBuilder.Sql(@"
IF COL_LENGTH('Invoices', 'NoteKind') IS NOT NULL
    EXEC('CREATE UNIQUE INDEX [IX_Invoices_CompanyId_DivisionId_InvoiceNumber] ON [Invoices] ([CompanyId], [DivisionId], [NoteKind], [InvoiceNumber])');
ELSE IF COL_LENGTH('Invoices', 'IsReturnNote') IS NOT NULL
    EXEC('CREATE UNIQUE INDEX [IX_Invoices_CompanyId_DivisionId_InvoiceNumber] ON [Invoices] ([CompanyId], [DivisionId], [IsReturnNote], [InvoiceNumber])');
ELSE
    CREATE UNIQUE INDEX [IX_Invoices_CompanyId_DivisionId_InvoiceNumber] ON [Invoices] ([CompanyId], [DivisionId], [InvoiceNumber]);");

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
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_GoodsReceipts_Divisions_DivisionId",
                table: "GoodsReceipts",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Invoices_Divisions_DivisionId",
                table: "Invoices",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PurchaseBills_Divisions_DivisionId",
                table: "PurchaseBills",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_SalesOrders_Divisions_DivisionId",
                table: "SalesOrders",
                column: "DivisionId",
                principalTable: "Divisions",
                principalColumn: "Id");
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
