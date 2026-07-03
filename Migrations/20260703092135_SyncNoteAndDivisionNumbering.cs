using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <summary>
    /// MERGE RECONCILE (master -> feat/sales-quote-order, 2026-07-03).
    ///
    /// The two branches each re-scoped the invoice numbering uniqueness:
    ///   - this branch:  (CompanyId, DivisionId, InvoiceNumber)  - per-division sequences
    ///   - master:       (CompanyId, NoteKind,  InvoiceNumber)   - per-note-kind sequences
    /// The merged model unifies them as
    ///   (CompanyId, DivisionId, NoteKind, InvoiceNumber) UNIQUE
    /// so a division-tagged bill, a company-level bill, a Credit Note and a
    /// Debit Note can each start at #1 without colliding, while concurrent
    /// MAX+1 allocation inside any one sequence still trips the unique index
    /// (audit C-8) and retries.
    ///
    /// Databases arrive here down THREE different histories - master-path
    /// (has the NoteKind index), branch-path (has the DivisionId index), and
    /// fresh replays (have both, created then superseded) - so both drops are
    /// conditional. Every other operation the model diff wanted is already
    /// provided by the branch's own migrations (divisions / payments / CoA)
    /// or master's note migrations; only the index reshape is genuinely new.
    /// </summary>
    public partial class SyncNoteAndDivisionNumbering : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_DivisionId_InvoiceNumber' AND object_id = OBJECT_ID('Invoices'))
    DROP INDEX [IX_Invoices_CompanyId_DivisionId_InvoiceNumber] ON [Invoices];");

            migrationBuilder.Sql(@"
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Invoices_CompanyId_NoteKind_InvoiceNumber' AND object_id = OBJECT_ID('Invoices'))
    DROP INDEX [IX_Invoices_CompanyId_NoteKind_InvoiceNumber] ON [Invoices];");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_DivisionId_NoteKind_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "DivisionId", "NoteKind", "InvoiceNumber" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Invoices_CompanyId_DivisionId_NoteKind_InvoiceNumber",
                table: "Invoices");

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_DivisionId_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "DivisionId", "InvoiceNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Invoices_CompanyId_NoteKind_InvoiceNumber",
                table: "Invoices",
                columns: new[] { "CompanyId", "NoteKind", "InvoiceNumber" },
                unique: true);
        }
    }
}
