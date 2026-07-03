using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SeparateDebitNoteNumbering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // MERGED 2026-07-03: both this migration and the note-numbering
            // migration on the other branch drop this index — whichever runs
            // second on a given database must tolerate it already being gone.
            migrationBuilder.Sql(@"IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_InvoiceNumber' AND object_id = OBJECT_ID('Invoices')) DROP INDEX [IX_Invoices_CompanyId_InvoiceNumber] ON [Invoices];");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_OriginalInvoiceId",
                table: "Invoices");

            migrationBuilder.AddColumn<int>(
                name: "CurrentDebitNoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingDebitNoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "IsReturnNote",
                table: "Invoices",
                type: "bit",
                nullable: false,
                computedColumnSql: "CASE WHEN [DocumentType] IN (9, 10) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END",
                stored: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_IsReturnNote_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "IsReturnNote", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_OriginalInvoiceId",
                table: "Invoices",
                column: "OriginalInvoiceId",
                unique: true,
                filter: "[OriginalInvoiceId] IS NOT NULL AND [IsCancelled] = 0");

            // ── Backfill ─────────────────────────────────────────────────
            // Notes created before this migration were numbered from the
            // SALE-invoice sequence (e.g. #3822). Renumber them into the new
            // per-company note sequence (1..N, creation order) — safe now
            // that uniqueness is scoped by IsReturnNote. Runs after the index
            // swap; set-based UPDATE is constraint-checked at end of statement.
            migrationBuilder.Sql(@"
;WITH n AS (
    SELECT Id, ROW_NUMBER() OVER (PARTITION BY CompanyId ORDER BY InvoiceNumber, Id) AS rn
    FROM Invoices
    WHERE DocumentType IN (9, 10)
)
UPDATE i SET i.InvoiceNumber = n.rn
FROM Invoices i
INNER JOIN n ON n.Id = i.Id;");

            // Display number: mark the note sequence so it can never be read
            // as a sale-invoice number.
            migrationBuilder.Sql(@"
UPDATE Invoices
SET FbrInvoiceNumber = 'DN-' + CAST(InvoiceNumber AS varchar(10))
WHERE DocumentType IN (9, 10);");

            // Seed company counters: StartingDebitNoteNumber defaults to 1
            // for existing rows; CurrentDebitNoteNumber = highest note so far.
            migrationBuilder.Sql(@"
UPDATE Companies SET StartingDebitNoteNumber = 1 WHERE StartingDebitNoteNumber <= 0;");
            migrationBuilder.Sql(@"
UPDATE c SET c.CurrentDebitNoteNumber = x.mx
FROM Companies c
INNER JOIN (
    SELECT CompanyId, MAX(InvoiceNumber) AS mx
    FROM Invoices WHERE DocumentType IN (9, 10)
    GROUP BY CompanyId
) x ON x.CompanyId = c.Id;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_IsReturnNote_InvoiceNumber",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_OriginalInvoiceId",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "IsReturnNote",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CurrentDebitNoteNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingDebitNoteNumber",
                table: "Companies");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_OriginalInvoiceId",
                table: "Invoices",
                column: "OriginalInvoiceId");
        }
    }
}
