using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class SplitCreditDebitNoteSeries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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

            migrationBuilder.AddColumn<bool>(
                name: "NoteAffectsStock",
                table: "Invoices",
                type: "bit",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "CurrentCreditNoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "StartingCreditNoteNumber",
                table: "Companies",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<byte>(
                name: "NoteKind",
                table: "Invoices",
                type: "tinyint",
                nullable: false,
                computedColumnSql: "CASE WHEN [DocumentType] = 9 THEN CAST(1 AS tinyint) WHEN [DocumentType] = 10 THEN CAST(2 AS tinyint) ELSE CAST(0 AS tinyint) END",
                stored: true);

            // MERGED 2026-07-03: division-aware for databases that carry
            // Invoices.DivisionId (see SeparateDebitNoteNumbering) — a plain
            // 3-column unique index fails on per-division duplicate numbers.
            migrationBuilder.Sql(@"
IF COL_LENGTH('Invoices', 'DivisionId') IS NOT NULL
    CREATE UNIQUE INDEX [IX_Invoices_CompanyId_NoteKind_InvoiceNumber] ON [Invoices] ([CompanyId], [DivisionId], [NoteKind], [InvoiceNumber]);
ELSE
    CREATE UNIQUE INDEX [IX_Invoices_CompanyId_NoteKind_InvoiceNumber] ON [Invoices] ([CompanyId], [NoteKind], [InvoiceNumber]);");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_OriginalInvoiceId_DocumentType",
                table: "Invoices",
                columns: new[] { "OriginalInvoiceId", "DocumentType" },
                unique: true,
                filter: "[OriginalInvoiceId] IS NOT NULL AND [IsCancelled] = 0");

            // ── Backfill ─────────────────────────────────────────────────
            // Existing notes were created by the earlier "Reverse" flow as
            // goods returns — they keep their numbers (already unique within
            // their type) and are marked as stock-moving.
            migrationBuilder.Sql(@"
UPDATE Invoices SET NoteAffectsStock = 1 WHERE DocumentType IN (9, 10) AND NoteAffectsStock IS NULL;");

            // Seed the credit-note counters (no credit notes exist yet in
            // either sequence — the earlier flow only produced debit notes).
            migrationBuilder.Sql(@"
UPDATE Companies SET StartingCreditNoteNumber = 1 WHERE StartingCreditNoteNumber <= 0;");
            migrationBuilder.Sql(@"
UPDATE c SET c.CurrentCreditNoteNumber = ISNULL(x.mx, 0)
FROM Companies c
LEFT JOIN (
    SELECT CompanyId, MAX(InvoiceNumber) AS mx
    FROM Invoices WHERE DocumentType = 10
    GROUP BY CompanyId
) x ON x.CompanyId = c.Id;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_NoteKind_InvoiceNumber",
                table: "Invoices");

            migrationBuilder.DropIndex(
                name: "IX_Invoices_OriginalInvoiceId_DocumentType",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "NoteKind",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "NoteAffectsStock",
                table: "Invoices");

            migrationBuilder.DropColumn(
                name: "CurrentCreditNoteNumber",
                table: "Companies");

            migrationBuilder.DropColumn(
                name: "StartingCreditNoteNumber",
                table: "Companies");

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
        }
    }
}
