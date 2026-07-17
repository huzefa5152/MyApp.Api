using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MyApp.Api.Migrations
{
    /// <inheritdoc />
    public partial class BackfillReconciledDateCleared : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // One-time backfill: existing receipts/payments/transfers are treated as
            // already CLEARED (reconciled as of their own date) — Manager-style
            // default. New rows get ReconciledDate on create. Runs once per DB.
            migrationBuilder.Sql(
                "UPDATE [Payments] SET [ReconciledDate] = [Date] " +
                "WHERE [ReconciledDate] IS NULL AND [IsCancelled] = 0;");
            migrationBuilder.Sql(
                "UPDATE [AccountTransfers] SET [ReconciledDate] = [Date] " +
                "WHERE [ReconciledDate] IS NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Non-reversible data backfill; no-op down.
        }
    }
}
