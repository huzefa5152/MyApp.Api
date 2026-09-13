using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportConsignmentSettlement : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ImportConsignmentId",
                table: "PaymentAllocations",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "AmountSettled",
                table: "ImportConsignments",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<decimal>(
                name: "ImportClearingCredited",
                table: "ImportConsignments",
                type: "decimal(18,2)",
                precision: 18,
                scale: 2,
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.CreateIndex(
                name: "IX_PaymentAllocations_ImportConsignmentId",
                table: "PaymentAllocations",
                column: "ImportConsignmentId");

            migrationBuilder.AddForeignKey(
                name: "FK_PaymentAllocations_ImportConsignments_ImportConsignmentId",
                table: "PaymentAllocations",
                column: "ImportConsignmentId",
                principalTable: "ImportConsignments",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            // Backfill ImportClearingCredited for every consignment that
            // already posted, BEFORE this column existed to record it — a
            // consignment posted under the old code has a real journal entry
            // (SourceDocType 6 = ImportConsignment) with exactly one balancing
            // credit line against the Import Clearing control account
            // (ControlType 20; PostingService.PostImportConsignmentAsync adds
            // exactly one such line per entry). Reading that line back is the
            // one place server truth about "what did this consignment actually
            // credit" still exists — the header totals on ImportConsignment
            // itself are client-submitted figures, not the posted amount (see
            // the property's own doc comment).
            //
            // A consignment with no such entry (Backfill mode, or New Arrivals
            // committed while the ledger was off) is untouched and keeps the
            // column's default of 0 — correct: neither one owes anything
            // through this route, so leaving it at 0 is not a placeholder.
            migrationBuilder.Sql(@"
                UPDATE c
                SET c.ImportClearingCredited = jl.Credit
                FROM ImportConsignments c
                JOIN JournalEntries je ON je.CompanyId = c.CompanyId
                                       AND je.SourceDocType = 6
                                       AND je.SourceDocId = c.Id
                JOIN JournalLines jl ON jl.JournalEntryId = je.Id
                JOIN Accounts a ON a.Id = jl.AccountId
                WHERE a.ControlType = 20;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PaymentAllocations_ImportConsignments_ImportConsignmentId",
                table: "PaymentAllocations");

            migrationBuilder.DropIndex(
                name: "IX_PaymentAllocations_ImportConsignmentId",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "ImportConsignmentId",
                table: "PaymentAllocations");

            migrationBuilder.DropColumn(
                name: "AmountSettled",
                table: "ImportConsignments");

            migrationBuilder.DropColumn(
                name: "ImportClearingCredited",
                table: "ImportConsignments");
        }
    }
}
