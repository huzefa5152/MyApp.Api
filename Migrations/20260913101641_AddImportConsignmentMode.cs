using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddImportConsignmentMode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Mode",
                table: "ImportConsignments",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "backfill");

            // Every consignment committed before this column existed predates
            // Task 19 (the Backfill/New Arrivals choice) entirely, so
            // "backfill" is not a guess for them -- it is what this feature
            // always did. The one thing that CAN be checked after the fact:
            // New Arrivals is the only mode that ever posts a journal entry
            // (SourceDocType 6 = ImportConsignment; see PostingService /
            // GdCostingImportService.CommitAsync). Any pre-existing row that
            // provably has one is flipped to "new-arrivals" so it is never
            // silently mis-tagged as Backfill and, if later deleted, wrongly
            // reversed by zeroing its cost instead of subtracting what it
            // added. Confirmed against the real installation on 2026-09-13:
            // zero ImportConsignment journal entries exist yet, so this
            // UPDATE affects 0 rows today and is here for correctness as the
            // feature is used going forward, not because it changes anything now.
            migrationBuilder.Sql(@"
                UPDATE c SET c.Mode = 'new-arrivals'
                FROM ImportConsignments c
                WHERE EXISTS (
                    SELECT 1 FROM JournalEntries je
                    WHERE je.SourceDocType = 6 AND je.SourceDocId = c.Id
                );
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Mode",
                table: "ImportConsignments");
        }
    }
}
